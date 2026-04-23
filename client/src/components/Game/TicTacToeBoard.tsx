// ============================================================
// TIC-TAC-TOE BOARD — interactive 3x3 grid
// ============================================================

import { useMemo } from 'react';
import { useRoom } from '../../stores/room';
import { useGame } from '../../hooks/useGame';
import { useSession } from '../../hooks/useSession';
import type { TicTacToeState, Player } from '@bored-games/shared';

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],           // diagonals
];

type Cell = '' | 'X' | 'O';

export function TicTacToeBoard() {
  const { room } = useRoom();
  const { state, isMyTurn, mySessionId, sendMove } = useGame();
  const { session } = useSession();

  const tttState = state?.gameType === 'tic-tac-toe' ? state as TicTacToeState : undefined;
  const isGameOver = room?.status === 'completed';
  const winnerId = tttState?.result?.winner ?? null;

  // Get current player symbol for hints
  const currentSymbol = useMemo(() => {
    if (!tttState || !mySessionId) return 'X';
    const idx = tttState.players.indexOf(mySessionId);
    return idx === 0 ? 'X' : 'O';
  }, [tttState, mySessionId]);

  // Find winning line
  const winningLine = useMemo((): number[] | null => {
    if (!tttState?.result?.winner || !tttState.board) return null;
    if (tttState.winningLine) {
      return tttState.winningLine.map(([r, c]: [number, number]) => r * 3 + c);
    }
    const cells = tttState.board.flat() as Cell[];
    for (const line of WINNING_LINES) {
      const [a, b, c] = line;
      if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) {
        return [a, b, c];
      }
    }
    return null;
  }, [tttState]);

  const handleCellClick = (index: number) => {
    if (!isMyTurn || isGameOver) return;
    if (!tttState) return;
    const cells = tttState.board.flat() as Cell[];
    if (cells[index] !== '') return;

    sendMove({ type: 'PLACE_MARK', cell: index });
  };

  const cells = useMemo(() => tttState ? tttState.board.flat() as Cell[] : Array(9).fill('') as Cell[], [tttState]);

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

  const showValidHints = isMyTurn && !isGameOver;
  const winner = winnerId ? room?.players.find((p: Player) => p.sessionId === winnerId) : null;

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
                ? `Click to place ${currentSymbol}`
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
              <span className="cell-hint">{currentSymbol}</span>
            )}
          </button>
        ))}
      </div>

      {/* Game result overlay */}
      {isGameOver && (
        <div className="game-result-banner">
          {winner ? (
            <span className="result-winner-name">
              {winner.sessionId === session.id ? 'You win! 🎉' : `${winner.displayName} wins!`}
            </span>
          ) : (
            <span className="result-winner-name">It's a draw!</span>
          )}
        </div>
      )}
    </div>
  );
}
