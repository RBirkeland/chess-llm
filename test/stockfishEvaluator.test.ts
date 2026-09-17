import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  convertCpToWinProbability,
  formatEvaluationDisplay,
  parseUciInfoLine,
} from '../src/shared/stockfishEvaluator.js'

describe('convertCpToWinProbability', () => {
  test('returns 50/50 for 0 centipawns', () => {
    const { whiteProb, blackProb } = convertCpToWinProbability(0)
    assert.equal(whiteProb, 50)
    assert.equal(blackProb, 50)
  })

  test('gives White high probability for +300 cp', () => {
    const { whiteProb, blackProb } = convertCpToWinProbability(300)
    assert.ok(whiteProb > 70 && whiteProb < 80)
    assert.equal(Math.round(whiteProb + blackProb), 100)
  })

  test('gives Black high probability for -300 cp', () => {
    const { whiteProb, blackProb } = convertCpToWinProbability(-300)
    assert.ok(blackProb > 70 && blackProb < 80)
    assert.equal(Math.round(whiteProb + blackProb), 100)
  })

  test('clamps probability between 1% and 99%', () => {
    const massiveWhite = convertCpToWinProbability(20000)
    assert.equal(massiveWhite.whiteProb, 99)
    assert.equal(massiveWhite.blackProb, 1)

    const massiveBlack = convertCpToWinProbability(-20000)
    assert.equal(massiveBlack.whiteProb, 1)
    assert.equal(massiveBlack.blackProb, 99)
  })
})

describe('formatEvaluationDisplay', () => {
  test('formats positive and negative pawn scores', () => {
    assert.equal(formatEvaluationDisplay(150, null), '+1.5')
    assert.equal(formatEvaluationDisplay(-80, null), '-0.8')
    assert.equal(formatEvaluationDisplay(0, null), '0.0')
  })

  test('formats mate scores', () => {
    assert.equal(formatEvaluationDisplay(null, 3), 'M3')
    assert.equal(formatEvaluationDisplay(null, -2), '-M2')
  })
})

describe('parseUciInfoLine', () => {
  test('parses centipawn score for White turn', () => {
    const line = 'info depth 10 seldepth 14 multipv 1 score cp 65 nodes 18230 pv e2e4 c7c5'
    const parsed = parseUciInfoLine(line, 'w')
    assert.ok(parsed)
    assert.equal(parsed.scoreCp, 65)
    assert.equal(parsed.depth, 10)
    assert.equal(parsed.bestMove, 'e2e4')
    assert.equal(parsed.displayEval, '+0.7')
    assert.ok((parsed.whiteWinProb ?? 0) > 50)
  })

  test('inverts score perspective for Black turn', () => {
    const line = 'info depth 12 seldepth 16 score cp 120 pv d7d5 g1f3'
    const parsed = parseUciInfoLine(line, 'b')
    assert.ok(parsed)
    assert.equal(parsed.scoreCp, -120) // From White's perspective
    assert.equal(parsed.displayEval, '-1.2')
    assert.ok((parsed.blackWinProb ?? 0) > 50)
  })

  test('parses mate in 2 for White turn', () => {
    const line = 'info depth 8 score mate 2 pv d1h5 g7g6'
    const parsed = parseUciInfoLine(line, 'w')
    assert.ok(parsed)
    assert.equal(parsed.mate, 2)
    assert.equal(parsed.whiteWinProb, 100)
    assert.equal(parsed.blackWinProb, 0)
    assert.equal(parsed.displayEval, 'M2')
  })

  test('parses mate in 1 against White (Black mate) for Black turn', () => {
    const line = 'info depth 6 score mate 1 pv h4f2'
    const parsed = parseUciInfoLine(line, 'b')
    assert.ok(parsed)
    assert.equal(parsed.mate, -1) // From White's perspective, White is getting mated
    assert.equal(parsed.whiteWinProb, 0)
    assert.equal(parsed.blackWinProb, 100)
    assert.equal(parsed.displayEval, '-M1')
  })
})
