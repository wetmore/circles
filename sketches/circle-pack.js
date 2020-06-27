const canvasSketch = require('canvas-sketch');
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

function calcPaletteIndices(circles, calcFunc, def) {
  const ts = [];
  const calcOrder = circles.slice().sort((a,b) => a.touched - b.touched);
  maxT = 0;
  minT = 1;
  for (let c of calcOrder) {
    let newT;
    if (c.touched >= 0) {
      const touched_t = ts[c.touched];
      if (touched_t === undefined) {
        console.error('Calculated out of order!');
      }
      newT = calcFunc(touched_t, c.inside);
    } else {
      newT = def;
    }
    if (newT > maxT) maxT = newT;
    if (newT < minT) minT = newT;
    ts[c.id] = newT;
  }

  return ts;
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

  attribute vec2 position;
  attribute vec2 uv;
  attribute float paletteIndex;

  varying vec3 vColor;
  varying vec2 vUv;

  void main() {
    vColor = vec3(paletteIndex, 0, 0);
    // 2 * position/resolution.xy - 1
    gl_Position = vec4(2. * (position)/resolution - 1., 0, 1);

    vUv = uv;
  }`,
  attributes: {
    position: (_, {pos, radius: r}) => { 
      const [x,y] = pos;
      return [
        x-r, y-r,
        x+r, y-r,
        x-r, y+r,
        x-r, y+r,
        x+r, y-r,
        x+r, y+r,]
    },
    uv: [
        0, 0,
        1, 0,
        0, 1,
        0, 1,
        1, 0,
        1, 1,],
    paletteIndex: () => { let x=1; return [0,x,x,x,x,0] },
  },
  uniforms: {
    resolution: ({viewportWidth, viewportHeight}) => [viewportWidth, viewportHeight],
    t: ({tick}) => tick,
  },
  count: 6,
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

const sketch = ({ gl, width, height }) => {
  // Setup REGL with our canvas context
  const regl = createRegl({ gl, extensions: ['OES_standard_derivatives', 'ANGLE_instanced_arrays'] });

  // Create framerate ticker
  var stats = new Stats();
  stats.showPanel( 0 ); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.body.appendChild( stats.dom );

  const settings = {
    width, height,
    n: 1000,
    maxSize: 400,
    minSize: 1,
    nested: true,
  }

  // Create gui
  const gui = new dat.GUI({ width: 400 });
  gui.add(settings, 'n').name('Max number of circles')
  gui.add(settings, 'maxSize').name('Max circle radius');
  gui.add(settings, 'minSize').name('Min circle radius');
  gui.add(settings, 'nested').name('Allow nested circles');

  let circles = [];

  let worker = work(require('./circles-worker.js'));
  worker.addEventListener('message', function (e) {
    if (e.data.type == 'DONE') {
      circles = e.data.circles;
      console.log(circles);
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
    regl.clear({
      color: [ 0, 0, 0, 1 ]
    });

    //console.log(deltaTime);

    // Draw meshes to scene
    draw(circles);
    stats.end();
  };
};

canvasSketch(sketch, settings);
