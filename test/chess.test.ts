import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Chess } from 'chess.js'
import {
  parseFen,
  formatMoveUci,
  buildChessTacticalContext,
  buildIllegalMoveRetryPrompt,
  SHARED_TACTICAL_CHECKLIST,
} from '../src/shared/chess.js'

describe('parseFen', () => {
  test('correctly parses initial chess position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    const parsed = parseFen(fen)

    assert.equal(parsed.turn, 'White')
    assert.equal(parsed.turnColor, 'w')
    assert.ok(parsed.asciiBoard.includes('r n b q k b n r'))
    assert.ok(parsed.asciiBoard.includes('P P P P P P P P'))
    assert.ok(parsed.whitePieces.some((p) => p === 'Rook on a1'))
    assert.ok(parsed.whitePieces.some((p) => p === 'King on e1'))
    assert.ok(parsed.blackPieces.some((p) => p === 'Queen on d8'))
    assert.ok(parsed.blackPieces.some((p) => p === 'King on e8'))
  })

  test('correctly parses Black turn position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    const parsed = parseFen(fen)

    assert.equal(parsed.turn, 'Black')
    assert.equal(parsed.turnColor, 'b')
    assert.ok(parsed.whitePieces.some((p) => p === 'Pawn on e4'))
  })
})

describe('formatMoveUci', () => {
  test('formats regular moves without promotion', () => {
    const uci = formatMoveUci({ from: 'e2', to: 'e4' })
    assert.equal(uci, 'e2e4')
  })

  test('formats promotion moves with lowercase promotion character', () => {
    const uci = formatMoveUci({ from: 'e7', to: 'e8', promotion: 'q' })
    assert.equal(uci, 'e7e8q')
  })
})

describe('buildChessTacticalContext', () => {
  test('builds comprehensive context including history and opponent move', () => {
    const chess = new Chess()
    chess.move('e4')
    chess.move('e5')
    chess.move('Nf3')

    const legalMoves = chess.moves({ verbose: true }).map((m) => ({
      uci: formatMoveUci(m),
      san: m.san,
    }))

    const context = buildChessTacticalContext({
      fen: chess.fen(),
      legalMoves,
      lastMove: { uci: 'g1f3', san: 'Nf3' },
      history: chess.history(),
    })

    assert.equal(context.turn, 'Black')
    assert.equal(context.inCheck, false)
    assert.equal(context.opponentLastMove, 'Nf3 (g1f3)')
    assert.equal(context.moveHistoryFormatted, '1. e4 e5 2. Nf3')
    assert.ok(context.legalMoves.length > 0)
    assert.ok(context.whitePieces.some((p) => p === 'Knight on f3'))
  })

  test('detects check in context', () => {
    // Position where White is in check from Black Queen
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/5PPq/8/PPPPP2P/RNBQKBNR w KQkq - 1 3'
    const chess = new Chess(fen)
    const legalMoves = chess.moves({ verbose: true }).map((m) => ({
      uci: formatMoveUci(m),
      san: m.san,
    }))

    const context = buildChessTacticalContext({
      fen,
      legalMoves,
      lastMove: { uci: 'd8h4', san: 'Qh4+' },
      history: ['f4', 'e5', 'g4', 'Qh4+'],
    })

    assert.equal(context.inCheck, true)
  })
})

describe('SHARED_TACTICAL_CHECKLIST and retry prompts', () => {
  test('checklist enforces candidate safety, 1-ply response check, and overall positional goal', () => {
    assert.ok(SHARED_TACTICAL_CHECKLIST.includes('Overall Winning Goal'))
    assert.ok(SHARED_TACTICAL_CHECKLIST.includes('Candidate safety'))
    assert.ok(SHARED_TACTICAL_CHECKLIST.includes('1-ply response check'))
    assert.ok(SHARED_TACTICAL_CHECKLIST.includes('King safety'))
  })

  test('buildIllegalMoveRetryPrompt formats clear illegal move recovery instruction', () => {
    const prompt = buildIllegalMoveRetryPrompt('xyz9', [{ uci: 'e2e4', san: 'e4' }], 'White')
    assert.ok(prompt.includes('xyz9'))
    assert.ok(prompt.includes('e2e4 (e4)'))
    assert.ok(prompt.includes('White'))
  })
})
