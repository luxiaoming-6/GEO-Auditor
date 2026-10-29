// Baidu Tongji (百度统计) queue. Declared globally — this file has no
// imports/exports on purpose so the interface merges into Window.
interface Window {
  _hmt: Array<Array<string | number | undefined>>;
}
