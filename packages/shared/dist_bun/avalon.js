// src/games/avalon.ts
function shuffle(arr) {
  const result = [...arr];
  for (let i = result.length - 1;i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function missionTeamSize(mission, playerCount) {
  const sizes = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5]
  };
  return sizes[playerCount]?.[mission - 1] ?? 3;
}
function requiresDoubleFail(mission, playerCount) {
  return [7, 8, 9, 10].indexOf(playerCount) !== -1 && mission === 4;
}
function nextLeaderIndex(players, current) {
  return (current + 1) % players.length;
}
function countGoodWins(results) {
  return results.filter((r) => r?.succeeded === true).length;
}
function countEvilWins(results) {
  return results.filter((r) => r?.succeeded === false).length;
}
var avalonEngine = {
  gameType: "avalon",
  minPlayers: 5,
  maxPlayers: 10,
  name: "Avalon: The Resistance",
  description: "Social deduction for 5–10 players. Hidden roles, secret missions, and deducing who to trust. No account needed.",
  slug: "avalon",
  icon: "⚔️",
  createInitialState(players) {
    const playerCount = players.length;
    const playerStates = players.map((sessionId) => ({
      sessionId,
      displayName: "Player"
    }));
    return {
      gameType: "avalon",
      players,
      turn: players[0],
      moveCount: 0,
      phase: "waiting",
      mission: 1,
      missionResults: [null, null, null, null, null],
      leaderIndex: 0,
      proposedTeam: [],
      votesReceived: [],
      votes: {},
      questCardsSubmitted: [],
      revealedQuestCards: [],
      abilitiesUsed: {
        clericUsed: false,
        revealerUsed: false,
        troublemakerUsed: false,
        tricksterUsed: false,
        witchUsed: false,
        lancelotReversed: false
      },
      assassinationTarget: null,
      assassinationVotes: {},
      playerStates,
      consecutiveRejects: 0,
      winner: null,
      gameEndReason: undefined,
      roleRevealTarget: null,
      roleSwap: null,
      revealedCardPlayer: null,
      witchSwapTarget: null,
      loversPair: null,
      loversDeath: false,
      updatedAt: Date.now()
    };
  },
  applyMove(state, move, playerId) {
    const playerIndex = state.players.indexOf(playerId);
    if (playerIndex === -1) {
      return {
        ok: false,
        error: { code: "PLAYER_NOT_IN_GAME", message: "You are not in this game." }
      };
    }
    switch (state.phase) {
      case "waiting":
        return { ok: false, error: { code: "INVALID_MOVE", message: "Game has not started yet." } };
      case "game_end":
        return { ok: false, error: { code: "GAME_OVER", message: "Game has already ended." } };
      case "team_proposal":
        return this.applyProposeTeam(state, move, playerId);
      case "team_vote":
        return this.applyVoteTeam(state, move, playerId);
      case "quest":
        return this.applyQuestCard(state, move, playerId);
      case "assassination":
        return this.applyAssassinate(state, move, playerId);
      case "role_assignment":
        return { ok: false, error: { code: "INVALID_MOVE", message: "Waiting for roles to be assigned." } };
      default:
        return { ok: false, error: { code: "INVALID_MOVE", message: `Unknown phase: ${state.phase}` } };
    }
  },
  applyProposeTeam(state, move, _playerId) {
    if (move.type !== "PROPOSE_TEAM") {
      return { ok: false, error: { code: "INVALID_MOVE", message: "Expected PROPOSE_TEAM." } };
    }
    const leader = state.players[state.leaderIndex];
    const requiredSize = missionTeamSize(state.mission, state.players.length);
    if (move.team.length !== requiredSize) {
      return {
        ok: false,
        error: {
          code: "INVALID_TARGET",
          message: `Mission ${state.mission} requires exactly ${requiredSize} players.`
        }
      };
    }
    for (const pid of move.team) {
      if (state.players.indexOf(pid) === -1) {
        return {
          ok: false,
          error: { code: "INVALID_TARGET", message: "Team member is not in the game." }
        };
      }
    }
    const newState = {
      ...state,
      proposedTeam: move.team,
      phase: "team_vote",
      votesReceived: [],
      votes: {},
      moveCount: state.moveCount + 1,
      updatedAt: Date.now()
    };
    return { ok: true, state: newState };
  },
  applyVoteTeam(state, move, playerId) {
    if (move.type !== "VOTE_TEAM") {
      return { ok: false, error: { code: "INVALID_MOVE", message: "Expected VOTE_TEAM." } };
    }
    if (state.votesReceived.indexOf(playerId) !== -1) {
      return {
        ok: false,
        error: { code: "ALREADY_VOTED", message: "You have already voted." }
      };
    }
    const newVotesReceived = [...state.votesReceived, playerId];
    const newVotes = { ...state.votes, [playerId]: move.approve };
    const newState = {
      ...state,
      votesReceived: newVotesReceived,
      votes: newVotes,
      moveCount: state.moveCount + 1,
      updatedAt: Date.now()
    };
    const approvals = Object.keys(newVotes).filter((k) => newVotes[k]).length;
    const rejections = Object.keys(newVotes).filter((k) => !newVotes[k]).length;
    const majority = Math.floor(state.players.length / 2) + 1;
    const approved = approvals >= majority;
    if (approvals >= majority || rejections >= majority) {
      if (!approved) {
        const newConsecutiveRejects = state.consecutiveRejects + 1;
        const newLeaderIndex = nextLeaderIndex(state.players, state.leaderIndex);
        if (newConsecutiveRejects >= 5) {
          const unilateralTeam = state.players.slice(0, missionTeamSize(state.mission, state.players.length));
          return {
            ok: true,
            state: {
              ...newState,
              phase: "quest",
              proposedTeam: unilateralTeam,
              questCardsSubmitted: [],
              revealedQuestCards: [],
              consecutiveRejects: 0,
              leaderIndex: newLeaderIndex,
              updatedAt: Date.now()
            }
          };
        }
        return {
          ok: true,
          state: {
            ...newState,
            phase: "team_proposal",
            leaderIndex: newLeaderIndex,
            proposedTeam: [],
            consecutiveRejects: newConsecutiveRejects,
            updatedAt: Date.now()
          }
        };
      }
      return {
        ok: true,
        state: {
          ...newState,
          phase: "quest",
          questCardsSubmitted: [],
          revealedQuestCards: [],
          consecutiveRejects: 0,
          updatedAt: Date.now()
        }
      };
    }
    return { ok: true, state: newState };
  },
  applyQuestCard(state, move, playerId) {
    if (move.type !== "SUBMIT_QUEST_CARD") {
      return { ok: false, error: { code: "INVALID_MOVE", message: "Expected SUBMIT_QUEST_CARD." } };
    }
    if (state.proposedTeam.indexOf(playerId) === -1) {
      return {
        ok: false,
        error: { code: "NOT_ON_PROPOSED_TEAM", message: "You are not on the proposed team." }
      };
    }
    if (state.questCardsSubmitted.indexOf(playerId) !== -1) {
      return {
        ok: false,
        error: { code: "ALREADY_SUBMITTED_QUEST_CARD", message: "You have already submitted a quest card." }
      };
    }
    const newCardsSubmitted = [...state.questCardsSubmitted, playerId];
    const newPlayerStates = state.playerStates.map((p) => {
      if (p.sessionId === playerId) {
        return { ...p, questCards: [...p.questCards ?? [], move.card] };
      }
      return p;
    });
    const newState = {
      ...state,
      playerStates: newPlayerStates,
      questCardsSubmitted: newCardsSubmitted,
      moveCount: state.moveCount + 1,
      updatedAt: Date.now()
    };
    if (newCardsSubmitted.length < state.proposedTeam.length) {
      return { ok: true, state: newState };
    }
    const teamCards = [];
    for (const pid of state.proposedTeam) {
      const ps = state.playerStates.filter((p) => p.sessionId === pid)[0];
      const lastCard = ps?.questCards != null ? ps.questCards[ps.questCards.length - 1] : undefined;
      if (lastCard)
        teamCards.push(lastCard);
    }
    const shuffled = shuffle(teamCards);
    const failCount = shuffled.filter((c) => c === "fail").length;
    const needsDoubleFail = requiresDoubleFail(state.mission, state.players.length);
    const questSucceeded = needsDoubleFail ? failCount < 2 : failCount === 0;
    const questResult = {
      succeeded: questSucceeded,
      failCards: failCount
    };
    const newMissionResults = [...state.missionResults];
    newMissionResults[state.mission - 1] = questResult;
    const goodWins = countGoodWins(newMissionResults);
    const evilWins = countEvilWins(newMissionResults);
    let loversDeath = state.loversDeath;
    if (state.loversPair) {
      const [a, b] = state.loversPair;
      const diedThisMission = state.proposedTeam.indexOf(a) !== -1 || state.proposedTeam.indexOf(b) !== -1;
      if (diedThisMission) {
        loversDeath = true;
      }
    }
    const newStateResolved = {
      ...newState,
      missionResults: newMissionResults,
      revealedQuestCards: shuffled,
      phase: "team_proposal",
      proposedTeam: [],
      votesReceived: [],
      votes: {},
      questCardsSubmitted: [],
      loversDeath,
      updatedAt: Date.now()
    };
    if (questSucceeded && state.mission < 5) {
      newStateResolved.mission = state.mission + 1;
    }
    if (goodWins >= 3) {
      return {
        ok: true,
        state: {
          ...newStateResolved,
          phase: "assassination",
          winner: null,
          updatedAt: Date.now()
        }
      };
    }
    if (evilWins >= 3) {
      return {
        ok: true,
        state: {
          ...newStateResolved,
          phase: "game_end",
          winner: "evil",
          gameEndReason: "THREE_MISSIONS_FAILED",
          result: { winner: null, reason: "THREE_MISSIONS_FAILED" },
          updatedAt: Date.now()
        }
      };
    }
    if (state.mission === 5 && !questSucceeded) {
      return {
        ok: true,
        state: {
          ...newStateResolved,
          phase: "game_end",
          winner: "evil",
          gameEndReason: "THREE_MISSIONS_FAILED",
          result: { winner: null, reason: "THREE_MISSIONS_FAILED" },
          updatedAt: Date.now()
        }
      };
    }
    if (state.mission === 5 && questSucceeded && goodWins < 3) {
      return {
        ok: true,
        state: {
          ...newStateResolved,
          phase: "game_end",
          winner: "good",
          gameEndReason: "THREE_MISSIONS_WON",
          result: { winner: null, reason: "THREE_MISSIONS_WON" },
          updatedAt: Date.now()
        }
      };
    }
    return { ok: true, state: newStateResolved };
  },
  applyAssassinate(state, move, playerId) {
    if (move.type !== "ASSASSINATE") {
      return { ok: false, error: { code: "INVALID_MOVE", message: "Expected ASSASSINATE." } };
    }
    const myState = state.playerStates.filter((p) => p.sessionId === playerId)[0];
    const isEvil = myState && ["minion", "mordred", "morgana", "evil_lancelot", "trickster", "witch", "brute"].indexOf(myState.role ?? "") !== -1;
    if (!isEvil) {
      return {
        ok: false,
        error: { code: "NOT_EVIL_PLAYER", message: "Only Evil players can vote on assassination." }
      };
    }
    const newVotes = { ...state.assassinationVotes, [playerId]: move.target };
    const newState = {
      ...state,
      assassinationVotes: newVotes,
      moveCount: state.moveCount + 1,
      updatedAt: Date.now()
    };
    const evilPlayers = state.playerStates.filter((p) => ["minion", "mordred", "morgana", "evil_lancelot", "trickster", "witch", "brute"].indexOf(p.role ?? "") !== -1);
    if (Object.keys(newVotes).length < evilPlayers.length) {
      return { ok: true, state: newState };
    }
    const voteCounts = {};
    for (const voteKey of Object.keys(newVotes)) {
      voteCounts[voteKey] = (voteCounts[voteKey] ?? 0) + 1;
    }
    let topTarget = "";
    let topCount = 0;
    for (const voteTarget of Object.keys(voteCounts)) {
      if (voteCounts[voteTarget] > topCount) {
        topCount = voteCounts[voteTarget];
        topTarget = voteTarget;
      }
    }
    const targetState = state.playerStates.filter((p) => p.sessionId === topTarget)[0];
    const isMerlin = targetState?.role === "merlin";
    if (isMerlin) {
      return {
        ok: true,
        state: {
          ...newState,
          phase: "game_end",
          assassinationTarget: topTarget,
          winner: "evil",
          gameEndReason: "MERLIN_ASSASSINATED",
          result: { winner: null, reason: "MERLIN_ASSASSINATED" },
          updatedAt: Date.now()
        }
      };
    }
    return {
      ok: true,
      state: {
        ...newState,
        phase: "game_end",
        assassinationTarget: topTarget,
        winner: "good",
        gameEndReason: "THREE_MISSIONS_WON",
        result: { winner: null, reason: "THREE_MISSIONS_WON" },
        updatedAt: Date.now()
      }
    };
  },
  checkGameEnd(state) {
    if (state.winner) {
      return state.result ?? { winner: null, reason: state.gameEndReason ?? "THREE_MISSIONS_WON" };
    }
    return null;
  },
  serialize(state) {
    return JSON.stringify(state);
  },
  deserialize(data) {
    return JSON.parse(data);
  }
};
export {
  avalonEngine
};
