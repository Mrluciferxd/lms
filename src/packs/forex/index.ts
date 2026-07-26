/**
 * Forex vertical pack.
 *
 * Everything forex-specific in the Nirlep proposal lives here. Core has no
 * knowledge of trading: the "Live Trades Journal" is a generic JournalDefinition,
 * the "Economic Calendar Dashboard" is a generic DataWidget over a pluggable
 * adapter, and "Live Market Sessions" are core LiveSessions with BROADCAST kind
 * relabelled below.
 *
 * Copy this directory to build the next vertical.
 */

import { definePack } from '../types'
import { economicCalendarAdapter } from './economic-calendar'
import { tradeJournal } from './trade-journal'

export const forexPack = definePack({
  key: 'forex',
  name: 'Forex & Trading Education',
  version: '1.0.0',
  description:
    'Trade journalling, live market broadcasts and economic calendar data for trading academies.',

  /**
   * Relabels generic core features in trading vocabulary. Remove the pack and
   * these revert to their neutral defaults — no schema change, no data loss.
   */
  labels: {
    'liveSession.kind.BROADCAST': 'Live Market Session',
    'liveSession.kind.BROADCAST.plural': 'Live Market Sessions',
    'liveSession.recording': 'Market Session Recording',
    'liveSession.upcoming': 'Upcoming Market Sessions',
    'nav.liveSessions': 'Live Market',
    'dashboard.liveNow': 'Market is live',
    'course.level.BEGINNER': 'Foundation',
    'course.level.INTERMEDIATE': 'Intermediate',
    'course.level.ADVANCED': 'Advanced / Funded',
  },

  journals: [tradeJournal],

  trackers: [
    {
      key: 'forex.challenge-progress',
      name: 'Funded Challenge Progress',
      description:
        'Tracks a student through a prop-firm evaluation: profit target reached, trading days completed, drawdown headroom.',
      type: 'GAUGE',
      scope: 'STUDENT',
      unit: '%',
      config: {
        target: 100,
        segments: [
          { key: 'profitTarget', label: 'Profit target', weight: 0.5 },
          { key: 'tradingDays', label: 'Minimum trading days', weight: 0.3 },
          { key: 'riskCompliance', label: 'Risk rules respected', weight: 0.2 },
        ],
      },
    },
  ],

  dataAdapters: [economicCalendarAdapter as never],

  dataWidgets: [
    {
      key: 'forex.economic-calendar',
      name: 'Economic Calendar',
      description:
        'High-impact macro releases for the currencies the academy trades.',
      adapterKey: 'forex.economic-calendar',
      config: {
        currencies: ['USD', 'EUR', 'GBP', 'JPY', 'INR'],
        minImpact: 'MEDIUM',
        lookaheadDays: 7,
      },
      refreshIntervalSec: 900,
      surfaces: ['student-dashboard', 'admin-dashboard', 'standalone'],
    },
  ],

  navItems: [
    {
      key: 'forex.market-sessions',
      label: 'Live Market',
      href: '/app/live',
      icon: 'radio',
      roles: ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF', 'STUDENT'],
      order: 30,
    },
    {
      key: 'forex.trade-journal',
      label: 'Trade Journal',
      href: '/app/journal/trade',
      icon: 'candlestick-chart',
      roles: ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF', 'STUDENT'],
      order: 40,
    },
    {
      key: 'forex.economic-calendar',
      label: 'Economic Calendar',
      href: '/app/widgets/forex.economic-calendar',
      icon: 'calendar-clock',
      roles: ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF', 'STUDENT'],
      order: 50,
    },
  ],

  notificationTemplates: [
    {
      key: 'forex.market-session-starting',
      name: 'Live market session starting',
      subject: '{{session.title}} starts in {{session.minutesUntil}} minutes',
      body:
        'Hi {{student.firstName}},\n\n' +
        '{{session.title}} goes live at {{session.startTime}} ({{org.timezone}}).\n\n' +
        'Join here: {{session.joinUrl}}\n\n' +
        '— {{org.name}}',
      channels: ['EMAIL', 'WHATSAPP', 'PUSH', 'IN_APP'],
      variables: [
        { key: 'session.title', description: 'Session title' },
        { key: 'session.startTime', description: 'Localised start time' },
        { key: 'session.minutesUntil', description: 'Minutes until start' },
        { key: 'session.joinUrl', description: 'Stream or meeting link' },
      ],
    },
    {
      key: 'forex.session-recording-ready',
      name: 'Market session recording available',
      subject: 'Recording ready: {{session.title}}',
      body:
        'Hi {{student.firstName}},\n\n' +
        'The recording of {{session.title}} is now in your library.\n\n' +
        'Watch it here: {{session.recordingUrl}}\n\n' +
        '— {{org.name}}',
      channels: ['EMAIL', 'IN_APP'],
    },
  ],

  notificationRules: [
    {
      key: 'forex.market-session-reminder',
      name: 'Remind students 15 minutes before a live market session',
      trigger: 'SESSION_STARTING',
      templateKey: 'forex.market-session-starting',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
      offsetMinutes: -15,
      enabled: true,
    },
  ],

  async onInstall(ctx) {
    await ctx.seedChannel({
      slug: 'market-talk',
      name: 'Market Talk',
      description: 'Daily market discussion, setups and trade ideas.',
    })
    await ctx.seedChannel({
      slug: 'trade-reviews',
      name: 'Trade Reviews',
      description: 'Post a journal entry here for mentor feedback.',
    })
    ctx.log('Forex pack installed: trade journal, economic calendar, 2 channels.')
  },
})

export default forexPack
