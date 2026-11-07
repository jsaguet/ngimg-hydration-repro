// Breaks down renderer main-thread work in a Chrome trace between user-timing marks.
//
// analyzeTrace(events, ['a', 'b', 'c']) returns one phase per pair of consecutive marks
// (a→b, b→c), each with main-thread self time grouped by kind of work, plus counters for the
// whole a→c window (style recalcs, layouts, paints, load events, ...).

export const TRACE_CATEGORIES = [
  'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
  'blink.user_timing', 'loading', 'v8.execute', 'blink', 'cc', 'gpu',
  'disabled-by-default-devtools.timeline.invalidationTracking',
];

export const GROUPS = [
  ['Script + DOM API', /^(FunctionCall|EvaluateScript|RunMicrotasks|TimerFire|FireAnimationFrame|v8\..*|V8\..*|MajorGC|MinorGC|BlinkGC.*)$/],
  ['Image re-fetch (memory cache)', /ResourceFetcher|ImageLoader|ImageResource|ResourceLoader/],
  ['Style recalc', /^(UpdateLayoutTree|RecalculateStyles|ScheduleStyleRecalculation|ParseAuthorStyleSheet|Document::recalcStyle|Document::updateStyle)$/],
  ['Layout (reflow)', /^(Layout|UpdateLayout|LocalFrameView::layout)$/],
  ['Intersection observers (lazy load)', /IntersectionObserver|ComputeIntersections/i],
  ['Paint / composite', /Paint|Layerize|UpdateLayer|CompositeLayers|^Commit$/],
  ['Image decode', /Decode|LazyPixelRef/i],
  ['Event dispatch', /^EventDispatch$/],
];
export const GROUP_NAMES = [...GROUPS.map(([g]) => g), 'Other'];
const groupOf = (name) => GROUPS.find(([, re]) => re.test(name))?.[0] ?? 'Other';

export function analyzeTrace(events, markNames) {
  const marks = markNames.map((name) => {
    const e = events.findLast((e) => e.name === name && e.cat?.includes('blink.user_timing'));
    if (!e) throw new Error(`mark "${name}" not found in trace`);
    return e;
  });
  const pid = marks[0].pid;
  const mainTid = events.find((e) => e.ph === 'M' && e.name === 'thread_name' && e.pid === pid &&
    e.args?.name === 'CrRendererMain').tid;
  const start = marks[0].ts;
  const end = marks.at(-1).ts;

  // Normalize B/E pairs into complete (X) events, per thread.
  const complete = [];
  const open = new Map();
  for (const e of events) {
    if (e.pid !== pid) continue;
    if (e.ph === 'X') complete.push(e);
    else if (e.ph === 'B') (open.get(e.tid) ?? open.set(e.tid, []).get(e.tid)).push(e);
    else if (e.ph === 'E') {
      const b = open.get(e.tid)?.pop();
      if (b) complete.push({...b, ph: 'X', dur: e.ts - b.ts, args: {...b.args, ...e.args}});
    }
  }

  // Self time per event name on the main thread, clipped to [t0, t1) (children subtracted).
  const selfTimes = (t0, t1) => {
    const evs = complete.filter((e) => e.tid === mainTid && e.dur > 0)
      .map((e) => ({name: e.name, ts: Math.max(e.ts, t0), end: Math.min(e.ts + e.dur, t1)}))
      .filter((e) => e.end > e.ts)
      .sort((a, b) => a.ts - b.ts || b.end - a.end);
    const stack = [];
    for (const e of evs) {
      while (stack.length && stack.at(-1).end <= e.ts) stack.pop();
      e.child = 0;
      const parent = stack.at(-1);
      if (parent && e.end <= parent.end) parent.child += e.end - e.ts;
      stack.push(e);
    }
    const byGroup = {}, byName = {};
    for (const e of evs) {
      const ms = (e.end - e.ts - e.child) / 1000;
      byGroup[groupOf(e.name)] = (byGroup[groupOf(e.name)] ?? 0) + ms;
      byName[e.name] = (byName[e.name] ?? 0) + ms;
    }
    return {byGroup, byName, total: Object.values(byGroup).reduce((a, b) => a + b, 0), wallMs: (t1 - t0) / 1000};
  };

  const inWin = (e) => e.ts >= start && e.ts < end;
  const main = complete.filter((e) => e.tid === mainTid && inWin(e));
  const instants = events.filter((e) => e.pid === pid && inWin(e));
  const count = (arr, pred) => arr.filter(pred).length;
  const sum = (arr, f) => arr.reduce((s, e) => s + (f(e) ?? 0), 0);
  return {
    phases: marks.slice(1).map((m, i) => ({from: markNames[i], to: markNames[i + 1], ...selfTimes(marks[i].ts, m.ts)})),
    counts: {
      'img load events dispatched': count(main, (e) => e.name === 'EventDispatch' && e.args?.data?.type === 'load'),
      'style recalcs': count(main, (e) => e.name === 'UpdateLayoutTree'),
      'elements restyled': sum(main.filter((e) => e.name === 'UpdateLayoutTree'), (e) => e.args?.elementCount),
      'style invalidations': count(instants, (e) => /Invalidation/.test(e.name)),
      'layouts (reflows)': count(main, (e) => e.name === 'Layout'),
      'layout objects dirtied': sum(main.filter((e) => e.name === 'Layout'), (e) => e.args?.beginData?.dirtyObjects),
      'paints': count(main, (e) => e.name === 'Paint'),
      'image decodes (all threads)': count(complete.filter(inWin), (e) => /Decode Image|ImageDecodeTask/.test(e.name)),
    },
  };
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
};
