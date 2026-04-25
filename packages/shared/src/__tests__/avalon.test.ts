import { describe, test, expect } from 'bun:test';
import { avalonEngine } from '../games/avalon';
import type { AvalonState, AvalonMove } from '../types';

const players5 = ['p1', 'p2', 'p3', 'p4', 'p5'];
const players7 = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

function makePlayerStates(ids: string[]) {
  return ids.map(id => ({ sessionId: id, displayName: `Player ${id}` }));
}

function makeState(overrides: Partial<AvalonState> = {}): AvalonState {
  return {
    gameType: 'avalon',
    players: [...players5],
    turn: 'p1',
    moveCount: 0,
    phase: 'waiting',
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
      lancelotReversed: false,
    },
    assassinationTarget: null,
    assassinationVotes: {},
    playerStates: makePlayerStates(players5),
    consecutiveRejects: 0,
    winner: null,
    gameEndReason: undefined,
    roleRevealTarget: null,
    roleSwap: null,
    revealedCardPlayer: null,
    witchSwapTarget: null,
    loversPair: null,
    loversDeath: false,
    updatedAt: Date.now(),
    ...overrides,
  } as AvalonState;
}

describe('avalonEngine.createInitialState', () => {
  test('starts in waiting phase', () => {
    const state = avalonEngine.createInitialState(players5);
    expect(state.phase).toBe('waiting');
  });

  test('mission starts at 1', () => {
    const state = avalonEngine.createInitialState(players5);
    expect(state.mission).toBe(1);
  });

  test('all mission results are null initially', () => {
    const state = avalonEngine.createInitialState(players5);
    expect(state.missionResults).toEqual([null, null, null, null, null]);
  });

  test('consecutiveRejects starts at 0', () => {
    const state = avalonEngine.createInitialState(players5);
    expect(state.consecutiveRejects).toBe(0);
  });

  test('leaderIndex starts at 0', () => {
    const state = avalonEngine.createInitialState(players5);
    expect(state.leaderIndex).toBe(0);
  });

  test('winner is null initially', () => {
    const state = avalonEngine.createInitialState(players5);
    expect(state.winner).toBeNull();
  });

  test('abilitiesUsed all false initially', () => {
    const state = avalonEngine.createInitialState(players5);
    expect(state.abilitiesUsed.clericUsed).toBe(false);
    expect(state.abilitiesUsed.revealerUsed).toBe(false);
    expect(state.abilitiesUsed.troublemakerUsed).toBe(false);
    expect(state.abilitiesUsed.tricksterUsed).toBe(false);
    expect(state.abilitiesUsed.witchUsed).toBe(false);
  });
});

describe('avalonEngine.applyMove — phase rejections', () => {
  test('rejects move in waiting phase', () => {
    const state = makeState({ phase: 'waiting' });
    const move: AvalonMove = { type: 'PROPOSE_TEAM', team: ['p1', 'p2'] };
    const result = avalonEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('INVALID_MOVE');
  });

  test('rejects move in game_end phase', () => {
    const state = makeState({ phase: 'game_end' });
    const move: AvalonMove = { type: 'PROPOSE_TEAM', team: ['p1', 'p2'] };
    const result = avalonEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('GAME_OVER');
  });

  test('rejects move in role_assignment phase', () => {
    const state = makeState({ phase: 'role_assignment' });
    const move: AvalonMove = { type: 'PROPOSE_TEAM', team: ['p1', 'p2'] };
    const result = avalonEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('INVALID_MOVE');
  });

  test('rejects move from player not in game', () => {
    const state = makeState({ phase: 'team_proposal' });
    const move: AvalonMove = { type: 'PROPOSE_TEAM', team: ['p1', 'p2'] };
    const result = avalonEngine.applyMove(state, move, 'stranger');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('PLAYER_NOT_IN_GAME');
  });
});

describe('avalonEngine.applyMove — PROPOSE_TEAM', () => {
  test('requires correct team size for mission 1 (5 players = 2)', () => {
    const state = makeState({ phase: 'team_proposal', mission: 1, players: players5 });
    const move: AvalonMove = { type: 'PROPOSE_TEAM', team: ['p1', 'p2', 'p3'] }; // 3 is wrong
    const result = avalonEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('INVALID_TARGET');
  });

  test('accepts valid team for mission 1 with 5 players', () => {
    const state = makeState({ phase: 'team_proposal', mission: 1, players: players5 });
    const move: AvalonMove = { type: 'PROPOSE_TEAM', team: ['p1', 'p2'] };
    const result = avalonEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(true);
    expect(result.state!.phase).toBe('team_vote');
    expect(result.state!.proposedTeam).toEqual(['p1', 'p2']);
  });

  test('rejects team with non-player', () => {
    const state = makeState({ phase: 'team_proposal' });
    const move: AvalonMove = { type: 'PROPOSE_TEAM', team: ['p1', 'stranger'] };
    const result = avalonEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
  });

  test('rejects non-PROPOSE_TEAM move in team_proposal phase', () => {
    const state = makeState({ phase: 'team_proposal' });
    const move: AvalonMove = { type: 'VOTE_TEAM', approve: true };
    const result = avalonEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
  });
});

describe('avalonEngine.applyMove — VOTE_TEAM', () => {
  test('accepts approve vote', () => {
    const state = makeState({ phase: 'team_vote', proposedTeam: ['p1', 'p2'] });
    const move: AvalonMove = { type: 'VOTE_TEAM', approve: true };
    const result = avalonEngine.applyMove(state, move, 'p3');
    expect(result.ok).toBe(true);
    expect(result.state!.votes['p3']).toBe(true);
    expect(result.state!.votesReceived).toContain('p3');
  });

  test('accepts reject vote', () => {
    const state = makeState({ phase: 'team_vote', proposedTeam: ['p1', 'p2'] });
    const move: AvalonMove = { type: 'VOTE_TEAM', approve: false };
    const result = avalonEngine.applyMove(state, move, 'p3');
    expect(result.ok).toBe(true);
    expect(result.state!.votes['p3']).toBe(false);
  });

  test('rejects player who already voted', () => {
    const state = makeState({
      phase: 'team_vote',
      proposedTeam: ['p1', 'p2'],
      votesReceived: ['p3'],
      votes: { p3: true },
    });
    const move: AvalonMove = { type: 'VOTE_TEAM', approve: false };
    const result = avalonEngine.applyMove(state, move, 'p3');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('ALREADY_VOTED');
  });
});

describe('avalonEngine.applyMove — team vote resolution', () => {
  // For 5 players, majority = ceil(5/2) = 3
  test('approved majority (3) advances to quest phase', () => {
    // Build state from scratch through all 3 votes to avoid any state chaining issues
    const s0 = makeState({ phase: 'team_vote', proposedTeam: ['p1', 'p2'], players: players5, leaderIndex: 0 });
    const s1 = avalonEngine.applyMove(s0, { type: 'VOTE_TEAM', approve: true }, 'p3');
    expect(s1.ok).toBe(true);
    expect(s1.state!.votesReceived).toContain('p3');
    expect(s1.state!.phase).toBe('team_vote');

    const s2 = avalonEngine.applyMove(s1.state!, { type: 'VOTE_TEAM', approve: true }, 'p4');
    expect(s2.ok).toBe(true);
    expect(s2.state!.votesReceived).toContain('p4');
    expect(s2.state!.phase).toBe('team_vote');

    const s3 = avalonEngine.applyMove(s2.state!, { type: 'VOTE_TEAM', approve: true }, 'p5');
    expect(s3.ok).toBe(true);
    expect(s3.state!.votesReceived).toContain('p5');
    expect(s3.state!.phase).toBe('quest');
  });

  test('rejected majority (3 rejects) returns to team_proposal with new leader', () => {
    let state = makeState({
      phase: 'team_vote',
      proposedTeam: ['p1', 'p2'],
      players: players5,
      leaderIndex: 0,
    });
    state = avalonEngine.applyMove(state, { type: 'VOTE_TEAM', approve: false }, 'p3').state!;
    state = avalonEngine.applyMove(state, { type: 'VOTE_TEAM', approve: false }, 'p4').state!;
    const result = avalonEngine.applyMove(state, { type: 'VOTE_TEAM', approve: false }, 'p5');
    expect(result.ok).toBe(true);
    expect(result.state!.phase).toBe('team_proposal');
    expect(result.state!.leaderIndex).toBe(1); // next leader
    expect(result.state!.consecutiveRejects).toBe(1);
  });
});

describe('avalonEngine.applyMove — SUBMIT_QUEST_CARD', () => {
  function makeQuestState(overrides: Partial<AvalonState> = {}): AvalonState {
    return makeState({
      phase: 'quest',
      proposedTeam: ['p1', 'p2'],
      questCardsSubmitted: [],
      playerStates: [
        { sessionId: 'p1', displayName: 'P1', questCards: ['success'] },
        { sessionId: 'p2', displayName: 'P2', questCards: ['fail'] },
        { sessionId: 'p3', displayName: 'P3' },
        { sessionId: 'p4', displayName: 'P4' },
        { sessionId: 'p5', displayName: 'P5' },
      ],
      ...overrides,
    });
  }

  test('accepts success card from proposed team member', () => {
    const state = makeQuestState();
    const result = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'success' }, 'p1');
    expect(result.ok).toBe(true);
    expect(result.state!.questCardsSubmitted).toContain('p1');
  });

  test('accepts fail card from proposed team member', () => {
    const state = makeQuestState();
    const result = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'fail' }, 'p2');
    expect(result.ok).toBe(true);
  });

  test('rejects card from player not on proposed team', () => {
    const state = makeQuestState();
    const result = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'success' }, 'p3');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('NOT_ON_PROPOSED_TEAM');
  });

  test('rejects duplicate card submission', () => {
    let state = makeQuestState();
    state = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'success' }, 'p1').state!;
    const result = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'fail' }, 'p1');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('ALREADY_SUBMITTED_QUEST_CARD');
  });

  test('rejects non-SUBMIT_QUEST_CARD in quest phase', () => {
    const state = makeQuestState();
    const move: AvalonMove = { type: 'PROPOSE_TEAM', team: ['p1', 'p2'] };
    const result = avalonEngine.applyMove(state, move, 'p1');
    expect(result.ok).toBe(false);
  });
});

describe('avalonEngine.applyMove — quest resolution', () => {
  // For 2-person quest with no fail cards needed (standard rules), all must succeed
  test('all success cards → mission succeeds (uses returned state)', () => {
    let state = makeState({
      phase: 'quest',
      mission: 1,
      proposedTeam: ['p1', 'p2'],
      questCardsSubmitted: [],
      playerStates: [
        { sessionId: 'p1', displayName: 'P1', questCards: ['success'] },
        { sessionId: 'p2', displayName: 'P2', questCards: ['success'] },
        { sessionId: 'p3', displayName: 'P3' },
        { sessionId: 'p4', displayName: 'P4' },
        { sessionId: 'p5', displayName: 'P5' },
      ],
    });
    state = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'success' }, 'p1').state!;
    const result = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'success' }, 'p2');
    expect(result.ok).toBe(true);
    expect(result.state!.missionResults[0]!.succeeded).toBe(true);
  });

  test('one fail card → mission fails (uses returned state)', () => {
    let state = makeState({
      phase: 'quest',
      mission: 1,
      proposedTeam: ['p1', 'p2'],
      questCardsSubmitted: [],
      playerStates: [
        { sessionId: 'p1', displayName: 'P1', questCards: ['success'] },
        { sessionId: 'p2', displayName: 'P2', questCards: ['fail'] },
        { sessionId: 'p3', displayName: 'P3' },
        { sessionId: 'p4', displayName: 'P4' },
        { sessionId: 'p5', displayName: 'P5' },
      ],
    });
    state = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'success' }, 'p1').state!;
    const result = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'fail' }, 'p2');
    expect(result.ok).toBe(true);
    expect(result.state!.missionResults[0]!.succeeded).toBe(false);
  });

  test('3 successful missions → good wins (uses returned state)', () => {
    let state = makeState({
      phase: 'quest',
      mission: 3,
      proposedTeam: ['p1', 'p2'],
      missionResults: [
        { succeeded: true, failCards: 0 },
        { succeeded: true, failCards: 0 },
        null,
        null,
        null,
      ],
      questCardsSubmitted: [],
      playerStates: [
        { sessionId: 'p1', displayName: 'P1', questCards: ['success'] },
        { sessionId: 'p2', displayName: 'P2', questCards: ['success'] },
        { sessionId: 'p3', displayName: 'P3' },
        { sessionId: 'p4', displayName: 'P4' },
        { sessionId: 'p5', displayName: 'P5' },
      ],
    });
    state = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'success' }, 'p1').state!;
    const result = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'success' }, 'p2');
    expect(result.ok).toBe(true);
    // After 3 successful missions, game goes to assassination phase (assassin can kill Merlin)
    expect(result.state!.phase).toBe('assassination');
    expect(result.state!.winner).toBeNull(); // No winner yet - assassination must happen first
  });

  test('3 failed missions → evil wins (uses returned state)', () => {
    let state = makeState({
      phase: 'quest',
      mission: 3,
      proposedTeam: ['p1', 'p2'],
      missionResults: [
        { succeeded: false, failCards: 1 },
        { succeeded: false, failCards: 1 },
        null,
        null,
        null,
      ],
      questCardsSubmitted: [],
      playerStates: [
        { sessionId: 'p1', displayName: 'P1', questCards: ['fail'] },
        { sessionId: 'p2', displayName: 'P2', questCards: ['fail'] },
        { sessionId: 'p3', displayName: 'P3' },
        { sessionId: 'p4', displayName: 'P4' },
        { sessionId: 'p5', displayName: 'P5' },
      ],
    });
    state = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'fail' }, 'p1').state!;
    const result = avalonEngine.applyMove(state, { type: 'SUBMIT_QUEST_CARD', card: 'fail' }, 'p2');
    expect(result.ok).toBe(true);
    expect(result.state!.phase).toBe('game_end');
    expect(result.state!.winner).toBe('evil');
  });
});

describe('avalonEngine.applyMove — ASSASSINATE', () => {
  function makeAssassinationState(): AvalonState {
    return makeState({
      phase: 'assassination',
      players: ['p1', 'p2', 'p3', 'p4', 'p5'],
      playerStates: [
        { sessionId: 'p1', displayName: 'P1', role: 'merlin' },
        { sessionId: 'p2', displayName: 'P2', role: 'servant' },
        { sessionId: 'p3', displayName: 'P3', role: 'minion' },
        { sessionId: 'p4', displayName: 'P4', role: 'minion' },
        { sessionId: 'p5', displayName: 'P5', role: 'mordred' },
      ],
    });
  }

  test('rejects non-ASSASSINATE move in assassination phase', () => {
    const state = makeAssassinationState();
    const move: AvalonMove = { type: 'VOTE_TEAM', approve: true };
    expect(avalonEngine.applyMove(state, move, 'p3').ok).toBe(false);
  });

  test('rejects assassination by good player', () => {
    const state = makeAssassinationState();
    const move: AvalonMove = { type: 'ASSASSINATE', target: 'p1' };
    const result = avalonEngine.applyMove(state, move, 'p2'); // servant tries
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('NOT_EVIL_PLAYER');
  });

  test('accepts assassination by evil player', () => {
    const state = makeAssassinationState();
    const move: AvalonMove = { type: 'ASSASSINATE', target: 'p1' };
    const result = avalonEngine.applyMove(state, move, 'p3'); // minion targets merlin
    expect(result.ok).toBe(true);
  });
});

describe('avalonEngine.checkGameEnd', () => {
  test('returns null when game is ongoing', () => {
    const state = makeState({ phase: 'team_proposal' });
    expect(avalonEngine.checkGameEnd(state)).toBeNull();
  });

  test('returns result when winner is set', () => {
    const state = makeState({ phase: 'game_end', winner: 'good', gameEndReason: 'THREE_MISSIONS_WON' });
    const result = avalonEngine.checkGameEnd(state);
    expect(result).toBeTruthy();
  });
});

describe('avalonEngine.serialize/deserialize', () => {
  test('roundtrips correctly', () => {
    const original = makeState({ phase: 'team_proposal' });
    const serialized = avalonEngine.serialize(original);
    const deserialized = avalonEngine.deserialize(serialized);
    expect(deserialized).toEqual(original);
  });
});
