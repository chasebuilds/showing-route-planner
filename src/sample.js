const T = (h, m = 0) => h * 60 + m;

/** An invented day: made-up streets and buyers placed on a real map region. */
export function sampleDay() {
  const stop = (id, label, lat, lng, open, close, dur, must = false) => ({ id, label, lat, lng, open, close, dur, must });
  return {
    start: { label: 'Sample office', lat: 35.7796, lng: -78.6382 },
    startTime: T(12, 15),
    stops: [
      stop('demo1', '418 Maple Ridge Dr', 35.8101, -78.612, T(13), T(14), 30, true),
      stop('demo2', '72 Cedar Hollow Ln', 35.748, -78.69, T(12, 30), T(15), 20),
      stop('demo3', '1905 Birchwood Ct', 35.842, -78.701, T(14), T(15, 30), 30, true),
      stop('demo4', '56 Harbor View Ter', 35.725, -78.59, T(13, 30), T(14, 30), 20),
      stop('demo5', '310 Quail Run Rd', 35.865, -78.575, T(15), T(17), 25),
      stop('demo6', '88 Linden Park Ave', 35.771, -78.556, T(12), T(13, 15), 20),
      stop('demo7', '2240 Foxglove Way', 35.79, -78.74, T(13), T(13, 45), 30),
    ],
  };
}
