import { avalonEngine } from './src/games/avalon.ts';

const players5 = ['p1', 'p2', 'p3', 'p4', 'p5'];

function makePlayerStates(ids) {
  return ids.map(id => ({ sessionId: id, displayName: `Player ${id}` }));
}

function makeState(overrides) {
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
  };
}

// Exact test setup
let state = makeState({
  phase: 'team_vote',
  proposedTeam: ['p1', 'p2'],
  players: players5,
  leaderIndex: 0,
});

console.log('Initial:', state.phase, 'votes:', JSON.stringify(state.votes));

// p3 approves (1/5)
const afterP3 = avalonEngine.applyMove(state, { type: 'VOTE_TEAM', approve: true }, 'p3');
state = afterP3.state;
console.log('After p3:', state.phase, 'votes:', JSON.stringify(state.votes));

// p4 approves (2/5) — still not majority  
const afterP4 = avalonEngine.applyMove(state, { type: 'VOTE_TEAM', approve: true }, 'p4');
console.log('After p4 phase check:', afterP4.state?.phase);
state = afterP4.state;
console.log('After p4:', state.phase, 'votes:', JSON.stringify(state.votes));

// p5 approves (3/5) — majority reached
const result = avalonEngine.applyMove(state, { type: 'VOTE_TEAM', approve: true }, 'p5');
console.log('After p5 result.ok:', result.ok, 'phase:', result.state?.phase);
console.log('Expected: quest');