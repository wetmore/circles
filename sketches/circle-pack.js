const canvasSketch = require('canvas-sketch');
const math = require('canvas-sketch-util/math');
const createRegl = require('regl');
const work = require('webworkify');
const Stats = require('stats.js');
const dat = require('dat.gui');

const settings = {
  // Make the loop animated
  animate: true,
  // Get a WebGL canvas rather than 2D
  context: 'webgl',
  // Turn on MSAA
  attributes: { antialias: false }
};

function calcPaletteIndices(circles, calcFunc, def, pIx) {
  const calcOrder = circles.slice().sort((a,b) => a.touched - b.touched);
  maxT = 0;
  minT = 1;
  for (let c of calcOrder) {
    let newT;
    if (c.touched >= 0) {
      const touched_t = pIx[c.touched];
      if (touched_t === undefined) {
        console.error('Calculated out of order!');
      }
      newT = calcFunc(touched_t, c.inside);
    } else {
      newT = def;
    }
    if (newT > maxT) maxT = newT;
    if (newT < minT) minT = newT;
    pIx[c.id] = newT;
  }
}

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
    
  //#ifdef GL_OES_standard_derivatives
  //  delta = fwidth(r);
  //  alpha = 1.0 - smoothstep(1.0 - delta, 1.0 + delta, r);
  //#endif
    alpha = 1. - step(1.,r);

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
      srcRGB:   'src alpha',
      srcAlpha: 'src alpha',
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
    n: 30000,
    maxSize: 500,
    minSize: 1,
    nested: true,
    lerpPercent: 0.1,
  }

  // Buffers used in render.
  let circles = [];
  let circlePos = [];
  let circleRad = [];

  // These will be initialized as Float32Arrays whenever a new set of circles
  // is generated.
  let pIx; // Palette indices, element i is pIx for circle with id i.
  let circlePIx; // Palette indices in order circles get rendered in.

  const makeCirclePIx = (lerpPercent) => {
    const calc = (t, inside) => {
      if (inside) {
        return math.lerp(t, 0, lerpPercent);
      } else {
        return math.lerp(t, 1, lerpPercent);
      }
    };
    calcPaletteIndices(circles, calc, 0.5, pIx);
    for (let i =0; i < circles.length; i++) {
      circlePIx[i] = pIx[circles[i].id];
    }
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
  lerpSlider.onChange(t => makeCirclePIx(t));

  let worker = work(require('./circles-worker.js'));
  worker.addEventListener('message', function (e) {
    if (e.data.type == 'DONE') {
      circles = e.data.circles;
      circlePos = circles.map(c => c.pos);
      circleRad = circles.map(c => c.radius);

      pIx = new Float32Array(circles.length);
      circlePIx = new Float32Array(circles.length);
      makeCirclePIx(settings.lerpPercent);

      worker.terminate();
    }
  });

  worker.postMessage({
      width: settings.width,
      height: settings.height,
      bgT: 0.5,
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
    if (circles.length > 0) {
      regl.clear({
        color: [ 0.5, 0, 0, 1 ]
      });

      //console.log(deltaTime);

      // Draw meshes to scene
      draw({ circlePos, circleRad, n: circles.length, circlePIx });
    }
    stats.end();
  };
};

canvasSketch(sketch, settings);
