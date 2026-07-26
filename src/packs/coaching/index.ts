/**
 * Coaching & exam-prep vertical pack.
 *
 * The second vertical, and the proof that the core is not a forex product with
 * generic naming. Nothing in src/app, src/server or prisma/schema.prisma changed
 * to support it — a coaching institute gets mock-test logging, syllabus tracking
 * and an exam calendar out of the same tables that give a trading academy trade
 * journals and an economic calendar.
 *
 * Note what is absent: no trading vocabulary, no market concepts, and no
 * dependency on the forex pack. The two are independent and can be enabled
 * together or separately.
 */

import { definePack } from '../types'
import { examCalendarAdapter } from './exam-calendar'
import { mockTestJournal } from './mock-test-journal'

export const coachingPack = definePack({
  key: 'coaching',
  name: 'Coaching & Exam Preparation',
  version: '1.0.0',
  description:
    'Mock test logging, syllabus completion tracking and exam calendars for test-prep and coaching institutes.',

  labels: {
    // Broadcasts are live classes here, not market sessions.
    'liveSession.kind.BROADCAST': 'Live Class',
    'liveSession.kind.BROADCAST.plural': 'Live Classes',
    'liveSession.kind.DOUBT_CLEARING': 'Doubt Session',
    'liveSession.kind.DOUBT_CLEARING.plural': 'Doubt Sessions',
    'liveSession.upcoming': 'Upcoming Classes',
    'nav.liveSessions': 'Live Classes',
    'dashboard.liveNow': 'Class in progress',
    // Course tiers as coaching institutes name them.
    'course.level.BEGINNER': 'Foundation',
    'course.level.INTERMEDIATE': 'Target',
    'course.level.ADVANCED': 'Crash Course',
  },

  journals: [mockTestJournal],

  trackers: [
    {
      key: 'coaching.syllabus-completion',
      name: 'Syllabus Completion',
      description: 'How much of the course syllabus a student has covered.',
      type: 'GAUGE',
      scope: 'STUDENT',
      unit: '%',
      config: { target: 100 },
    },
    {
      key: 'coaching.tests-attempted',
      name: 'Tests Attempted',
      description: 'Mock tests completed against the target for this batch.',
      type: 'COUNTER',
      scope: 'STUDENT',
      unit: 'tests',
      config: { target: 50 },
    },
    {
      /**
       * Exercises the EXPIRY tracker type: institutes commonly sell time-boxed
       * test-series or library access alongside the course itself.
       */
      key: 'coaching.test-series-access',
      name: 'Test Series Access',
      description: 'Time-boxed access to the test series and question bank.',
      type: 'EXPIRY',
      scope: 'STUDENT',
      remindBeforeDays: 7,
    },
  ],

  dataAdapters: [examCalendarAdapter as never],

  dataWidgets: [
    {
      key: 'coaching.exam-calendar',
      name: 'Exam Calendar',
      description: 'Application windows, admit cards, exam and result dates.',
      adapterKey: 'coaching.exam-calendar',
      config: { lookaheadDays: 90 },
      // Refreshed hourly: exam boards publish daily at most, not by the minute.
      refreshIntervalSec: 3600,
      surfaces: ['student-dashboard', 'admin-dashboard', 'standalone'],
    },
  ],

  navItems: [
    {
      key: 'coaching.live-classes',
      label: 'Live Classes',
      href: '/app/live',
      icon: 'video',
      roles: ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF', 'STUDENT'],
      order: 30,
    },
    {
      key: 'coaching.mock-tests',
      label: 'Mock Tests',
      href: '/app/journal/mock-test',
      icon: 'clipboard-check',
      roles: ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF', 'STUDENT'],
      order: 40,
    },
    {
      key: 'coaching.exam-calendar',
      label: 'Exam Calendar',
      href: '/app/widgets/coaching.exam-calendar',
      icon: 'calendar-clock',
      roles: ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF', 'STUDENT'],
      order: 50,
    },
  ],

  notificationTemplates: [
    {
      key: 'coaching.class-reminder',
      name: 'Live class reminder',
      subject: '{{session.title}} starts in {{session.minutesUntil}} minutes',
      body:
        'Hi {{student.firstName}},\n\n' +
        '{{session.title}} begins at {{session.startTime}} ({{org.timezone}}).\n\n' +
        'Join here: {{session.joinUrl}}\n\n' +
        '— {{org.name}}',
      channels: ['EMAIL', 'WHATSAPP', 'PUSH', 'IN_APP'],
      variables: [
        { key: 'session.title', description: 'Class title' },
        { key: 'session.startTime', description: 'Localised start time' },
        { key: 'session.minutesUntil', description: 'Minutes until start' },
        { key: 'session.joinUrl', description: 'Class joining link' },
      ],
    },
    {
      key: 'coaching.result-published',
      name: 'Mock test result published',
      subject: 'Result out: {{test.name}}',
      body:
        'Hi {{student.firstName}},\n\n' +
        'Your result for {{test.name}} is available.\n\n' +
        'Score: {{test.marksScored}} / {{test.totalMarks}}\n' +
        'Rank: {{test.rank}}\n\n' +
        'Review it here: {{test.url}}\n\n' +
        '— {{org.name}}',
      channels: ['EMAIL', 'WHATSAPP', 'IN_APP'],
      variables: [
        { key: 'test.name', description: 'Test name' },
        { key: 'test.marksScored', description: 'Marks scored' },
        { key: 'test.totalMarks', description: 'Total marks' },
        { key: 'test.rank', description: 'Rank achieved' },
      ],
    },
  ],

  notificationRules: [
    {
      key: 'coaching.class-reminder',
      name: 'Remind students 30 minutes before a live class',
      trigger: 'CLASS_REMINDER',
      templateKey: 'coaching.class-reminder',
      channels: ['EMAIL', 'WHATSAPP', 'PUSH', 'IN_APP'],
      offsetMinutes: -30,
      enabled: true,
    },
  ],

  async onInstall(ctx) {
    await ctx.seedChannel({
      slug: 'doubts',
      name: 'Doubts',
      description: 'Ask subject doubts here — faculty and peers both answer.',
    })
    await ctx.seedChannel({
      slug: 'study-group',
      name: 'Study Group',
      description: 'Peer discussion, study plans and revision partners.',
    })
    ctx.log('Coaching pack installed: mock test log, exam calendar, 2 channels.')
  },
})

export default coachingPack
