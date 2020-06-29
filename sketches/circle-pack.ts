const canvasSketch = require('canvas-sketch');
const math = require('canvas-sketch-util/math');
const createRegl = require('regl');
const work = require('webworkify');
import Stats = require('stats.js');
const dat = require('dat.gui');

const INITIAL_NUM_CIRCLES = 60000

const settings = {
  // Make the loop animated
  animate: true,
  // Get a WebGL canvas rather than 2D
  context: 'webgl',
  // Turn on MSAA
  attributes: { antialias: false, alpha: false }
};

const drawAttrs = {
  frag: `
  #ifdef GL_OES_standard_derivatives
  #extension GL_OES_standard_derivatives : enable
  #endif

  precision mediump float;

  varying vec3 vColor;
  varying vec2 vUv;

  void main() {

    float r = 0.0, delta = 0.0, alpha = 1.0;
    vec2 cxy = 2.0 * vUv - 1.0;
    r = dot(cxy, cxy);
    
  #ifdef GL_OES_standard_derivatives
    delta = fwidth(r);
    // the +delta/2 term makes you able to see the edges of the quad... but if i do 1-delta circles dont touch
    // i could make quad a bit bigger but the math would be annoying
    alpha = 1.0 - smoothstep(1.0-delta/2., 1.0+delta/2., r);
  #endif
    //alpha = 1. - step(1.,r); // no antialias

    gl_FragColor = vec4(vColor, alpha);
    gl_FragColor.rgb *= gl_FragColor.a;
  }`,
  vert: `
  precision mediump float;

  uniform vec2 resolution;
  uniform float t;

  attribute vec2 quadPoint;
  attribute vec2 position;
  attribute float radius;
  attribute vec2 uv;
  attribute float paletteIndex;

  varying vec3 vColor;
  varying vec2 vUv;

  void main() {
    vColor = vec3(paletteIndex, 0, 0);
    // 2 * position/resolution.xy - 1
    gl_Position = vec4(2. * (position + radius*quadPoint)/resolution - 1., 0, 1);

    vUv = uv;
  }`,
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

  const settings = {
    width: canvasWidth, height: canvasHeight,
    n: INITIAL_NUM_CIRCLES,
    maxSize: 500,
    minSize: 1,
    nested: true,
    lerpPercent: 0.1,
    bgIndex: 0.5,
  }

  let numLoadedCircles = 0;

  let circlePos = regl.buffer(settings.n);
  let circleRad = regl.buffer(settings.n);
  
  // Info about circle touches.
  let touchInfo: Int32Array; 
  // The order in which to calculate circle color indices.
  let calcOrder: Int32Array;


  let pIx: Float32Array;  // Array to use for calculating palette indices values
  // Buffer with that info
  let circlePIx = regl.buffer({ length: settings.n });

  const makeCirclePIx = (lerpPercent: number) => {
    // Interesting lerp function.
    const calc = (t, inside) => {
      if (inside) {
        return math.lerp(t, 0, lerpPercent);
      } else {
        return math.lerp(t, 1, lerpPercent);
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
        // TODO this won't ever trigger now that i use typedarray
        if (touched_t === undefined) {
          console.error('Calculated out of order!');
        }
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
  const lerpSlider = colorGui.add(settings, 'lerpPercent', 0, 1).name('Span (need better name)');
  const startSlider = colorGui.add(settings, 'bgIndex', 0, 1).name('BG palette index');
  lerpSlider.onChange(makeCirclePIx);
  startSlider.onChange(makeCirclePIx);

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
      makeCirclePIx(settings.lerpPercent);

      worker.terminate();
    }
  });

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

  const d = 50;

  // Return the renderer function
  return ({ deltaTime }) => {
    stats.begin();
    // Update regl sizes
    regl.poll();

    // Clear back buffer
    if (numLoadedCircles > 0) {
      regl.clear({
        color: [ settings.bgIndex, 0, 0, 1 ]
      });

      //console.log(deltaTime);

      // Draw meshes to scene
      draw({ circlePos, circleRad, n: numLoadedCircles, circlePIx });
    }
    stats.end();
  };
};

canvasSketch(sketch, settings);
