const canvasSketch = require("canvas-sketch");
const math = require("canvas-sketch-util/math");
const createRegl = require("regl");
const work = require("webworkify");
import Stats = require("stats.js");
const dat = require("dat.gui");
const Hammer = require('hammerjs');

const fragmentShader = require("./circle.frag");
const vertexShader = require("./circle.vert");

const INITIAL_NUM_CIRCLES = 100;

const settings = {
  //dimensions: [5*screen.width/8, 5*screen.height/8],
  pixelRatio: window.devicePixelRatio,
  // Make the loop animated
  animate: true,
  // Get a WebGL canvas rather than 2D
  context: "webgl",
  // Turn on MSAA
  attributes: { antialias: false, alpha: false },
};

const sketch = ({ gl, width, height, canvasWidth, canvasHeight, canvas }) => {
  // Setup REGL with our canvas context
  const regl = createRegl({
    gl,
    extensions: ["OES_standard_derivatives", "ANGLE_instanced_arrays"],
  });

  // Create framerate ticker
  var stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.body.appendChild(stats.dom);

  // Settings for the sketch.
  const settings = {
    seed: 'seed',
    width: canvasWidth,
    height: canvasHeight,
    n: INITIAL_NUM_CIRCLES,
    maxSize: 1000,
    minSize: 2,
    nested: true,
    lerpPercent: 0.4,
    lerpExponent: 0.4,
    bgIndex: 0.5,
    animate: false,
  };

  let numLoadedCircles = 0;

  // Info about circle touches.
  let touchInfo: Int32Array;
  // The order in which to calculate circle palette indices.
  let calcOrder: Int32Array;
  // Array to use for calculating palette index values
  let pIx: Float32Array;

  // Buffers used by regl.
  let bufPosition = regl.buffer(settings.n);
  let bufRadius = regl.buffer(settings.n);
  let bufPIx = regl.buffer(settings.n);

  // Flags controlling frame behaviour.
  let NEEDS_DRAW = false;
  let NEEDS_PIX_CALC = false;

  // Create gui
  const gui = new dat.GUI({ width: Math.min(400, screen.availWidth) });
  if (screen.availWidth < 400) {
    let guiEl = <HTMLElement>document.querySelector('.dg.a')
    guiEl.style.margin = '0';
  }

  if (screen.availWidth < 450) {
    stats.dom.style.bottom = '0';
    stats.dom.style.top = '';
  }

  const genGui = gui.addFolder("Generator options");
  genGui.add(settings, "n").name("Max number of circles");
  genGui.add(settings, "maxSize").name("Max circle radius");
  genGui.add(settings, "minSize").name("Min circle radius");
  genGui.add(settings, "nested").name("Allow nested circles");
  genGui.add(settings, "seed").name("Randomizer seed");

  const colorGui = gui.addFolder("Color options");
  const lerpSlider = colorGui
    .add(settings, "lerpPercent", 0, 1)
    .name("Span (need better name)")
    .listen();
  const startSlider = colorGui
    .add(settings, "bgIndex", 0, 1)
    .name("BG palette index")
    .listen();
  const expSlider = colorGui
    .add(settings, "lerpExponent", 0, 5)
    .name("Exponent")
    .listen();
  lerpSlider.onChange(() => {
    NEEDS_PIX_CALC = true;
  });
  startSlider.onChange(() => {
    NEEDS_PIX_CALC = true;
  });
  expSlider.onChange(() => {
    NEEDS_PIX_CALC = true;
  });
  colorGui.add(settings, "animate");

  // Set up touch events
  let hammer = new Hammer(canvas);
  hammer.on('panmove', (e) => {
    const u = e.center.x / width;
    const v = e.center.y / height
    if (e.pointers.length == 1) {
      settings.lerpPercent = u;
      settings.bgIndex = v;
    }
    if (e.pointers.length == 2) {
      settings.lerpExponent = v*5;
    }
    NEEDS_PIX_CALC = true;
  });



  let worker = work(require("./circles-worker.ts"));
  worker.addEventListener("message", function (e) {
    if (e.data.type == "LOADING") {
      // LOL
      document.title = Math.floor((e.data.num / e.data.total) * 100) + "%";
    }
    if (e.data.type == "DONE") {
      console.log(e.data);
      numLoadedCircles = e.data.n;

      // Re-initialize buffers with new data.
      bufPosition({ data: e.data.positions });
      bufRadius({ data: e.data.radii });

      // Initialize new palette index array, which is used when palette indices
      // are calculated.
      pIx = new Float32Array(numLoadedCircles);

      // Create the calcOrder array, which defines the order in which to
      // calculate palette index values for the circles. An element i in
      // calcOrder represents the circle with position bufPosition[i] and
      // radius bufRadius[i].
      // If i < j in calcOrder, pIx[i] will be set before pIx[j].
      touchInfo = e.data.touchInfo;
      calcOrder = new Int32Array(numLoadedCircles);
      for (let i = 0; i < touchInfo.length; i++) {
        calcOrder[i] = i;
      }
      calcOrder.sort((a, b) => Math.abs(touchInfo[a]) - Math.abs(touchInfo[b]));

      // Tell render loop to calculate palette indices before rendering next
      // frame.
      NEEDS_PIX_CALC = true;
    }
  });

  let buttons = {};
  buttons['generate'] = () => {
    worker.postMessage({
      seed: settings.seed,
      width: settings.width,
      height: settings.height,
      bgT: settings.bgIndex,
      maxAttempts: 10000,
      circleCount: settings.n,
      maxCircleSize: settings.maxSize,
      minCircleSize: settings.minSize,
      nested: settings.nested,
    });
  }

  genGui.add(buttons, 'generate').name('Click to generate!');

  // Regl GL draw commands
  const drawCircles = regl({
    frag: fragmentShader,
    vert: vertexShader,
    attributes: {
      // prevent hard edges at nesw points of circle
      quadPoint: [
        -1.2,
        -1.2,
        +1.2,
        -1.2,
        -1.2,
        +1.2,
        -1.2,
        +1.2,
        +1.2,
        -1.2,
        +1.2,
        +1.2,
      ],
      uv: [-0.1, -0.1, 1.1, -0.1, -0.1, 1.1, -0.1, 1.1, 1.1, -0.1, 1.1, 1.1],
      position: { buffer: regl.prop("bufPosition"), divisor: 1 },
      radius: { buffer: regl.prop("bufRadius"), divisor: 1 },
      paletteIndex: { buffer: regl.prop("bufPIx"), divisor: 1 },
    },
    uniforms: {
      resolution: (ctx) => [ctx["viewportWidth"], ctx["viewportHeight"]],
      t: regl.context("tick"),
    },
    count: 6,
    instances: regl.prop("n"),
    depth: { enable: false },
    blend: {
      enable: true,
      // See: https://stackoverflow.com/questions/45066688/blending-anti-aliased-circles-with-regl
      func: {
        srcRGB: "one", // making these two 'src alpha' creates neat effect
        srcAlpha: "one",
        dstRGB: "one minus src alpha",
        dstAlpha: "one minus src alpha",
      },
    },
  });

  const drawBackground = regl({
    frag: `
    precision mediump float;
    uniform float paletteIndex;

    vec3 palette( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d ) {
      return a + b*cos( 6.28318*(c*t+d) );
    }

    void main() {
      vec3 color = palette( paletteIndex, vec3(0.5,0.5,0.5),vec3(0.5,0.5,0.5),vec3(1.0,1.0,1.0),vec3(0.0,0.1,0.2) );//vec3(paletteIndex, 0, 0);
      //vec3 color = vec3(paletteIndex, 0,0);
      gl_FragColor = vec4(color, 1);
    }`,

    vert: `
    precision mediump float;

    attribute vec2 position;

    void main() {
      gl_Position = vec4(position, 0, 1);
    }`,
    count: 6,
    attributes: {
      position: [-1, -1, +1, -1, -1, +1, -1, +1, +1, -1, +1, +1],
    },
    uniforms: {
      paletteIndex: regl.prop("index"),
    },
  });

  // Initial circle generation
  buttons['generate']();

  // Return the renderer function
  return ({ deltaTime, time }) => {
    stats.begin();
    // Update regl sizes
    regl.poll();

    // Clear back buffer
    if (numLoadedCircles > 0) {
      regl.clear({
        color: [0, 0, 0, 1],
      });

      if (settings.animate) {
        settings.lerpPercent =
          ((1 + Math.cos(time / 4)) * (1 + Math.sin(time))) / 4;
        settings.bgIndex = (1 + Math.sin((1 / 3) * time)) / 2;
        NEEDS_PIX_CALC = true;
      }

      if (NEEDS_PIX_CALC) {
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
            if (inside) {
              newT = math.lerp(
                touched_t,
                0,
                settings.lerpPercent ** settings.lerpExponent
              );
            } else {
              newT = math.lerp(
                touched_t,
                1,
                settings.lerpPercent ** settings.lerpExponent
              );
            }
          }
          if (newT > maxT) maxT = newT;
          if (newT < minT) minT = newT;
          pIx[i] = newT;
        }

        bufPIx({ data: pIx });
        NEEDS_PIX_CALC = false;
        NEEDS_DRAW = true;
      }

      if (NEEDS_DRAW) {
        drawBackground({ index: settings.bgIndex });
        drawCircles({ bufPosition, bufRadius, n: numLoadedCircles, bufPIx });
      }
    }
    stats.end();
  };
};

canvasSketch(sketch, settings);
