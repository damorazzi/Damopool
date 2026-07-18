// Thin ECharts init/setOption/resize/dispose lifecycle wrapper --
// docs/ARCHITECTURE.md Section 14. Page modules never call the ECharts
// API directly; they pass an option object and get a managed chart
// instance back, and dispose() is guaranteed to be called on route
// teardown (the caller's responsibility to invoke, this module's
// responsibility to make trivial).
//
// DOM- and ECharts-dependent -- reviewed by reading, the same tradeoff
// already made for router.js's createRouter and shell.js's mountShell.
// No DOM/ECharts emulation dependency has been added to this project's
// test setup (docs/ARCHITECTURE.md Section 3.3), so this file has no
// unit tests of its own; option-*building* logic (pure data -> ECharts
// option shape) lives in the page module that needs it and is tested
// there instead.
//
// docs/ARCHITECTURE.md Section 3.2: ECharts is loaded via CDN by
// whichever page mounts a chart, not bundled or imported here -- this
// module expects a global `echarts` (or an injected `echartsLib`) to
// already exist by the time createChart is called.
export function createChart(container, option, { echartsLib } = {}) {
  const lib = echartsLib ?? (typeof window !== "undefined" ? window.echarts : undefined);
  if (!lib) {
    throw new Error(
      "createChart: no ECharts library available -- expected window.echarts " +
        "(docs/ARCHITECTURE.md Section 3.2) or an injected echartsLib",
    );
  }

  const instance = lib.init(container);
  instance.setOption(option);

  const resizeObserver = new ResizeObserver(() => instance.resize());
  resizeObserver.observe(container);

  return {
    update(nextOption) {
      instance.setOption(nextOption);
    },
    dispose() {
      resizeObserver.disconnect();
      instance.dispose();
    },
  };
}
