// ============================================================
// TIC-TAC-TOE BOARD — interactive 3x3 grid
// ============================================================

import { useMemo } from 'react';
import { useRoom } from '../../stores/room';
import { useGame } from '../../hooks/useGame';
import { useSession } from '../../hooks/useSession';
import type { TicTacToeState, TicTacToeMove } from '@bored-games/shared/src/types';

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],           // diagonals
];

type Cell = '' | 'X' | 'O';

function cellsFromState(state: TicTacToeState | undefined): Cell[] {
  if (!state?.board) return Array(9).fill('');
  return state.board as Cell[];
}

export function TicTacToeBoard() {
  const { room } = useRoom();
  const { sendMove } = useGame();
  const { session } = useSession();

  const cells = useMemo(() => cellsFromState(room?.game as TicTacToeState | undefined), [room?.game]);
  const gameState = room?.game as TicTacToeState | undefined;
  const isMyTurn = gameState?.currentPlayerId === session?.id;
  const isGameOver = room?.status === 'game_over';
  const winnerId = gameState?.winnerId;
  const winner = room?.players.find((p) => p.sessionId === winnerId);

  // Find winning line for highlight
  const winningLine = useMemo(() => {
    if (!gameState?.winnerId) return null;
    for (const line of WINNING_LINES) {
      const [a, b, c] = line;
      if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) {
        return line;
      }
    }
    return null;
  }, [cells, gameState?.winnerId]);

  // Valid moves are all empty cells
  const validMoves = useMemo(() => {
    if (isGameOver) return [];
    return cells
      .map((c, i) => (c === '' ? i : null))
      .filter((i): i is number => i !== null);
  }, [cells, isGameOver]);

  const handleCellClick = (index: number) => {
    if (!isMyTurn || isGameOver) return;
    if (cells[index] !== '') return;

    const move: TicTacToeMove = { cell: index };
    sendMove(move);
  };

  const getCellClass = (index: number) => {
    const classes = ['cell'];
    if (cells[index] === 'X') classes.push('cell-x');
    if (cells[index] === 'O') classes.push('cell-o');
    if (winningLine?.includes(index)) classes.push('cell-winner');
    if (!isGameOver && isMyTurn && cells[index] === '') {
      classes.push('cell-valid');
    }
    return classes.join(' ');
  };

  // Show valid move hints on hover when it's your turn
  const showValidHints = isMyTurn && !isGameOver;

  return (
    <div className="ttt-board-wrapper">
      <div className="ttt-board" role="grid" aria-label="Tic-Tac-Toe board">
        {cells.map((cell, index) => (
          <button
            key={index}
            className={getCellClass(index)}
            onClick={() => handleCellClick(index)}
            disabled={!isMyTurn || isGameOver || cell !== ''}
            aria-label={`Cell ${index + 1}${cell ? `, marked ${cell}` : ', empty'}`}
            title={
              showValidHints && cell === ''
                ? `Click to place ${gameState?.currentPlayerSymbol}`
                : undefined
            }
          >
            {cell === 'X' && (
              <svg viewBox="0 0 100 100" className="mark-svg mark-x">
                <line x1="15" y1="15" x2="85" y2="85" />
                <line x1="85" y1="15" x2="15" y2="85" />
              </svg>
            )}
            {cell === 'O' && (
              <svg viewBox="0 0 100 100" className="mark-svg mark-o">
                <circle cx="50" cy="50" r="35" />
              </svg>
            )}
            {showValidHints && cell === '' && (
              <span className="cell-hint">{gameState?.currentPlayerSymbol}</span>
            )}
          </button>
        ))}
      </div>

      {/* Game result overlay */}
      {isGameOver && (
        <div className="game-result-banner">
          {winner ? (
            <>
              <span className="result-winner-name">
                {winner.sessionId === session?.id ? 'You win! 🎉' : `${winner.displayName} wins!`}
              </span>
            </>
          ) : (
            <span className="result-winner-name">It's a draw!</span>
          )}
        </div>
      )}
    </div>
  );
}
