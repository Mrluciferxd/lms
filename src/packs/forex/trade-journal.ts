/**
 * The proposal's "Live Trades Journal", expressed as a generic
 * JournalDefinition. Nothing here is code — it is data the pack installer
 * writes into JournalDefinition, which means an admin can extend the field set
 * later without a deploy, and a non-trading client gets the same journalling UI
 * with a completely different field schema.
 */

import type { PackJournalDefinition } from '../types'

export const tradeJournal: PackJournalDefinition = {
  key: 'trade',
  name: 'Trade Journal',
  singular: 'Trade',
  description:
    'Log planned and executed positions with risk parameters, then review outcomes against the original thesis.',
  icon: 'candlestick-chart',
  studentAuthored: true,
  /** Positions open and later close — drives the OPEN/CLOSED lifecycle. */
  hasLifecycle: true,

  fields: [
    {
      key: 'symbol',
      label: 'Instrument',
      type: 'text',
      required: true,
      placeholder: 'EURUSD',
      help: 'Pair, index or commodity ticker.',
    },
    {
      key: 'direction',
      label: 'Direction',
      type: 'select',
      required: true,
      options: [
        { value: 'LONG', label: 'Long / Buy' },
        { value: 'SHORT', label: 'Short / Sell' },
      ],
    },
    {
      key: 'orderType',
      label: 'Order type',
      type: 'select',
      options: [
        { value: 'MARKET', label: 'Market' },
        { value: 'LIMIT', label: 'Limit' },
        { value: 'STOP', label: 'Stop' },
      ],
      defaultValue: 'MARKET',
    },
    {
      key: 'timeframe',
      label: 'Timeframe',
      type: 'select',
      options: [
        { value: 'M1', label: '1 minute' },
        { value: 'M5', label: '5 minute' },
        { value: 'M15', label: '15 minute' },
        { value: 'M30', label: '30 minute' },
        { value: 'H1', label: '1 hour' },
        { value: 'H4', label: '4 hour' },
        { value: 'D1', label: 'Daily' },
        { value: 'W1', label: 'Weekly' },
      ],
    },
    {
      key: 'setup',
      label: 'Setup / strategy',
      type: 'text',
      help: 'The named playbook entry this trade came from.',
    },
    {
      key: 'entryAt',
      label: 'Entry time',
      type: 'datetime',
      required: true,
    },
    {
      key: 'entryPrice',
      label: 'Entry price',
      type: 'number',
      required: true,
      step: 0.00001,
    },
    {
      key: 'stopLoss',
      label: 'Stop loss',
      type: 'number',
      step: 0.00001,
      help: 'Required for risk-to-reward and R-multiple calculations.',
    },
    {
      key: 'takeProfit',
      label: 'Take profit',
      type: 'number',
      step: 0.00001,
    },
    {
      key: 'lotSize',
      label: 'Position size',
      type: 'number',
      required: true,
      step: 0.01,
      unit: 'lots',
      defaultValue: 0.1,
    },
    {
      key: 'contractSize',
      label: 'Units per lot',
      type: 'number',
      defaultValue: 100000,
      help: 'Standard FX lot is 100,000 units. Adjust for indices and metals.',
    },
    {
      key: 'riskPercent',
      label: 'Account risked',
      type: 'percent',
      step: 0.1,
      help: 'Percentage of account equity at risk if the stop is hit.',
    },
    {
      key: 'exitAt',
      label: 'Exit time',
      type: 'datetime',
    },
    {
      key: 'exitPrice',
      label: 'Exit price',
      type: 'number',
      step: 0.00001,
    },
    {
      key: 'exitReason',
      label: 'Exit reason',
      type: 'select',
      options: [
        { value: 'TP_HIT', label: 'Target hit' },
        { value: 'SL_HIT', label: 'Stop hit' },
        { value: 'MANUAL', label: 'Closed manually' },
        { value: 'BREAKEVEN', label: 'Moved to breakeven' },
        { value: 'TIME', label: 'Time-based exit' },
        { value: 'PARTIAL', label: 'Partial close' },
      ],
    },
    {
      key: 'thesis',
      label: 'Trade thesis',
      type: 'textarea',
      help: 'Why you took it — written before the outcome is known.',
    },
    {
      key: 'chartBefore',
      label: 'Chart at entry',
      type: 'image',
    },
    {
      key: 'chartAfter',
      label: 'Chart at exit',
      type: 'image',
    },
    {
      key: 'mistakes',
      label: 'Execution errors',
      type: 'multiselect',
      options: [
        { value: 'EARLY_ENTRY', label: 'Entered early' },
        { value: 'LATE_ENTRY', label: 'Entered late' },
        { value: 'MOVED_STOP', label: 'Moved stop against me' },
        { value: 'OVERSIZED', label: 'Oversized position' },
        { value: 'NO_PLAN', label: 'Not in the playbook' },
        { value: 'REVENGE', label: 'Revenge trade' },
        { value: 'CUT_WINNER', label: 'Cut a winner short' },
      ],
      help: 'Reviewed in mentor sessions — the most valuable field in the journal.',
    },
    {
      key: 'reviewNotes',
      label: 'Post-trade review',
      type: 'textarea',
    },
  ],

  /**
   * R-multiple and planned R:R are deliberately sign-agnostic: for a short,
   * numerator and denominator both invert, so the ratio stays correct without
   * branching on direction.
   */
  computed: [
    {
      key: 'plannedRR',
      label: 'Planned R:R',
      expr: 'abs(takeProfit - entryPrice) / abs(entryPrice - stopLoss)',
      type: 'number',
      precision: 2,
    },
    {
      key: 'rMultiple',
      label: 'R multiple',
      expr: '(exitPrice - entryPrice) / (entryPrice - stopLoss)',
      type: 'number',
      precision: 2,
    },
    {
      key: 'pnlAmount',
      label: 'P&L',
      expr:
        '(exitPrice - entryPrice) * lotSize * contractSize * (direction == "LONG" ? 1 : -1)',
      type: 'currency',
      precision: 2,
    },
    {
      key: 'priceMove',
      label: 'Price move',
      expr: 'abs(exitPrice - entryPrice)',
      type: 'number',
      precision: 5,
    },
  ],

  listColumns: [
    'symbol',
    'direction',
    'entryAt',
    'entryPrice',
    'exitPrice',
    'rMultiple',
    'pnlAmount',
    'exitReason',
  ],
}
