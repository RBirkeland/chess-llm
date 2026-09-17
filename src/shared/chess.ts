import { Chess } from 'chess.js'
import type { Move, Color } from 'chess.js'

export interface LegalMoveInfo {
  uci: string
  san: string
}

export const PIECE_NAMES: Record<string, string> = {
  K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn',
  k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn',
}

export function formatMoveUci(move: Move | { from: string; to: string; promotion?: string }): string {
  return `${move.from}${move.to}${move.promotion ? move.promotion.toLowerCase() : ''}`
}

export function parseFen(fen: string) {
  const [placement, turn] = fen.split(' ')
  const ranks = placement.split('/')
  const boardRows: string[][] = []
  const whitePieces: string[] = []
  const blackPieces: string[] = []

  ranks.forEach((rankStr, rankIndex) => {
    const rankNum = 8 - rankIndex
    const row: string[] = []
    let fileIdx = 0
    for (const char of rankStr) {
      if (/[1-8]/.test(char)) {
        const emptyCount = parseInt(char, 10)
        for (let i = 0; i < emptyCount; i++) {
          row.push('.')
          fileIdx++
        }
      } else {
        row.push(char)
        const fileLetter = String.fromCharCode(97 + fileIdx)
        const square = `${fileLetter}${rankNum}`
        const pieceName = PIECE_NAMES[char] ?? char
        if (char === char.toUpperCase()) {
          whitePieces.push(`${pieceName} on ${square}`)
        } else {
          blackPieces.push(`${pieceName} on ${square}`)
        }
        fileIdx++
      }
    }
    boardRows.push(row)
  })

  const asciiBoard = boardRows
    .map((row, idx) => `${8 - idx}  ${row.join(' ')}`)
    .join('\n') + '\n   a b c d e f g h'

  return {
    turn: turn === 'w' ? 'White' : 'Black',
    turnColor: (turn === 'w' ? 'w' : 'b') as Color,
    asciiBoard,
    whitePieces,
    blackPieces,
  }
}

export interface ChessTacticalContext {
  fen: string
  turn: 'White' | 'Black'
  turnColor: Color
  asciiBoard: string
  whitePieces: string[]
  blackPieces: string[]
  opponentLastMove: string
  moveHistoryFormatted: string
  legalMoves: LegalMoveInfo[]
  inCheck: boolean
}

export function buildChessTacticalContext(options: {
  fen: string
  legalMoves: LegalMoveInfo[]
  lastMove?: { uci: string; san: string } | null
  history?: string[]
}): ChessTacticalContext {
  const { fen, legalMoves, lastMove, history } = options
  const parsed = parseFen(fen)
  const chess = new Chess(fen)

  const moveHistoryFormatted = history && history.length > 0
    ? history
        .map((san, idx) => (idx % 2 === 0 ? `${Math.floor(idx / 2) + 1}. ${san}` : `${san}`))
        .join(' ')
    : 'None (game starting)'

  return {
    fen,
    turn: parsed.turn as 'White' | 'Black',
    turnColor: parsed.turnColor,
    asciiBoard: parsed.asciiBoard,
    whitePieces: parsed.whitePieces,
    blackPieces: parsed.blackPieces,
    opponentLastMove: lastMove ? `${lastMove.san} (${lastMove.uci})` : 'None (start of game)',
    moveHistoryFormatted,
    legalMoves,
    inCheck: chess.inCheck(),
  }
}

/**
 * Tactical Checklist and Strategic Objective shared equally across both Jev and Competitors
 */
export const SHARED_TACTICAL_CHECKLIST = `
STRATEGIC GOAL & TACTICAL SAFETY CHECKLIST:
1. Overall Winning Goal: Your primary objective is to make the strongest move to win the game by building the best overall position. This is NOT about grabbing material immediately if it hurts king safety, development, piece coordination, or central control.
2. Candidate safety: Verify that your destination square is safe or defended. Do not make uncompensated Queen or piece sacrifices.
3. 1-ply response check: Consider opponent's immediate replies and captures before committing to your move.
4. King safety: Defend your king and keep pieces coordinated.
5. Selection: You MUST choose exactly one move from the provided legal moves list.
`.trim()

export function buildIllegalMoveRetryPrompt(
  invalidInput: string,
  legalMoves: LegalMoveInfo[],
  turn: 'White' | 'Black',
): string {
  return `The move "${invalidInput}" is not a legal move in this position.
Please choose a valid legal move for ${turn} from this exact list:
${legalMoves.map((m) => `${m.uci} (${m.san})`).join(', ')}`
}
