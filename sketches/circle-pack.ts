const canvasSketch = require('canvas-sketch');
const math = require('canvas-sketch-util/math');
const createRegl = require('regl');
const work = require('webworkify');
import Stats = require('stats.js');
const dat = require('dat.gui');

const fragmentShader = require('./circle.frag');
const vertexShader = require('./circle.vert');

const INITIAL_NUM_CIRCLES = 6000

const settings = {
  // Make the loop animated
  animate: true,
  // Get a WebGL canvas rather than 2D
  context: 'webgl',
  // Turn on MSAA
  attributes: { antialias: false, alpha: false }
};

const drawAttrs = {
  frag: fragmentShader,
  vert: vertexShader,
  attributes: {
    quadPoint: [
        -1, -1,
        +1, -1,
        -1, +1,
        -1, +1,
        +1, -1,
        +1, +1,],
    position: (_, { circlePos }) => ({ buffer: circlePos, divisor: 1 }), 
    radius: (_, { circleRad }) => ({ buffer: circleRad, divisor: 1 }), 
    uv: [
        0, 0,
        1, 0,
        0, 1,
        0, 1,
        1, 0,
        1, 1,],
    paletteIndex: (_, { circlePIx }) => ({ buffer: circlePIx, divisor: 1 }),
  },
  uniforms: {
    resolution: ({viewportWidth, viewportHeight}) => [viewportWidth, viewportHeight],
    t: ({tick}) => tick,
  },
  count: 6,
  instances: (_, {n}) => n,
  depth: {enable: false},
  blend: {
    enable: true,
    // See: https://stackoverflow.com/questions/45066688/blending-anti-aliased-circles-with-regl
    func: {
      srcRGB:   'one', // making these two 'src alpha' creates neat effect
      srcAlpha: 'one',
      dstRGB:   'one minus src alpha',
      dstAlpha: 'one minus src alpha'
    }
  }

};

const sketch = ({ gl, canvasWidth, canvasHeight }) => {
  // Setup REGL with our canvas context
  const regl = createRegl({ gl, extensions: ['OES_standard_derivatives', 'ANGLE_instanced_arrays'] });

  // Create framerate ticker
  var stats = new Stats();
  stats.showPanel( 0 ); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.body.appendChild( stats.dom );

  // Settings for the sketch.
  const settings = {
    width: canvasWidth, height: canvasHeight,
    n: INITIAL_NUM_CIRCLES,
    maxSize: 500,
    minSize: 1,
    nested: true,
    lerpPercent: 0.1,
    bgIndex: 0.5,
    animate: false,
  }

  let numLoadedCircles = 0;
  
  // Info about circle touches.
  let touchInfo: Int32Array; 
  // The order in which to calculate circle color indices.
  let calcOrder: Int32Array;
  // Array to use for calculating palette index values
  let pIx: Float32Array; 

  // Buffers used by regl.
  let circlePos = regl.buffer(settings.n);
  let circleRad = regl.buffer(settings.n);
  let circlePIx = regl.buffer({ length: settings.n });

  // Flags controlling frame behaviour.
  let NEEDS_DRAW = false;
  let NEEDS_PIX_CALC = false;

  const makeCirclePIx = () => {
    // Interesting lerp function.
    const calc = (t, inside) => {
      if (inside) {
        return math.lerp(t, 0, settings.lerpPercent);
      } else {
        return math.lerp(t, 1, settings.lerpPercent);
      }
    };

    // Sort the indices, such that if i < j in sorted indices, pIx[i] will be set
    // before pIx[j].
    let maxT = 0;
    let minT = 1;
    for (let i = 0; i < calcOrder.length; i++) {
      let newT = settings.bgIndex;
      let info = touchInfo[i];
      if (info !== 0) {
        const inside = info < 0;
        if (inside) {
          info *= -1;
        }
        const touchedIndex = info - 1;
        const touched_t = pIx[touchedIndex];
        newT = calc(touched_t, inside);
      }
      if (newT > maxT) maxT = newT;
      if (newT < minT) minT = newT;
      pIx[i] = newT;
    }

    //circlePIx.subdata(pIx);
    circlePIx({data: pIx});
  };

  // Create gui
  const gui = new dat.GUI({ width: 400 });
  
  const genGui = gui.addFolder('Generator options');
  genGui.add(settings, 'n').name('Max number of circles')
  genGui.add(settings, 'maxSize').name('Max circle radius');
  genGui.add(settings, 'minSize').name('Min circle radius');
  genGui.add(settings, 'nested').name('Allow nested circles');

  const colorGui = gui.addFolder('Color options');
  const lerpSlider = colorGui.add(settings, 'lerpPercent', 0, 1).name('Span (need better name)').listen();
  const startSlider = colorGui.add(settings, 'bgIndex', 0, 1).name('BG palette index').listen();
  lerpSlider.onChange(() => {NEEDS_PIX_CALC = true});
  startSlider.onChange(() => {NEEDS_PIX_CALC = true});
  colorGui.add(settings, 'animate');

  let worker = work(require('./circles-worker.js'));
  worker.addEventListener('message', function (e) {
    if (e.data.type == 'DONE') {
      numLoadedCircles = e.data.n;

      circlePos({ data: e.data.positions });
      circleRad({ data: e.data.radii });

      touchInfo = e.data.touchInfo;

      calcOrder = new Int32Array(numLoadedCircles)
      for (let i = 0; i < touchInfo.length; i++) {
        calcOrder[i] = i;
      }
      calcOrder.sort((a,b) => Math.abs(touchInfo[a]) - Math.abs(touchInfo[b]));

      pIx = new Float32Array(numLoadedCircles);
      // move out into loop and trigger with a flag
      
      NEEDS_PIX_CALC = true;

      worker.terminate();
    }
  });

  // Kick off a generation request
  worker.postMessage({
      width: settings.width,
      height: settings.height,
      bgT: settings.bgIndex,
      maxAttempts: 10000,
      circleCount: settings.n,
      maxCircleSize: settings.maxSize,
      minCircleSize: settings.minSize,
      nested: settings.nested,
    });

  // Regl GL draw commands
  const draw = regl(drawAttrs);

  // Return the renderer function
  return ({ deltaTime, time }) => {
    stats.begin();
    // Update regl sizes
    regl.poll();

    // Clear back buffer
    if (numLoadedCircles > 0) {
      regl.clear({
        color: [ settings.bgIndex, 0, 0, 1 ]
      });

      if (settings.animate) {
        settings.lerpPercent = (1 + Math.cos(time/4))*(1 + Math.sin(time))/4;
        settings.bgIndex = (1 + Math.sin(1/3 * time))/2;
        NEEDS_PIX_CALC = true;
      }

      if (NEEDS_PIX_CALC) {
        makeCirclePIx();
        NEEDS_DRAW = true;
      }

      if (NEEDS_DRAW) {
        draw({ circlePos, circleRad, n: numLoadedCircles, circlePIx });
      }
    }
    stats.end();
  };
};

canvasSketch(sketch, settings);
