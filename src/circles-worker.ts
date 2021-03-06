const random = require('canvas-sketch-util/random')

module.exports = function (self) {
  self.addEventListener("message", function (e) {
    random.setSeed(e.data.seed);

    const data = e.data;
    const w = data.width;
    const h = data.height;
    const bgT = data.bgT;
    const maxAttempts = data.maxAttempts;
    const n = data.circleCount;
    const maxCircleSize = data.maxCircleSize;
    const minCircleSize = data.minCircleSize;
    const nested = data.nested;

    const circles = [];
    let attempts = 0;

    console.log(`Generating ${n} circles in ${w}x${h}`);

    // This is for calculating a rolling average of circle sizes.
    let buffer = [];
    let bufferTotal = 0;
    const maxBuffer = 50;

    while (circles.length < n && attempts < maxAttempts) {
      // Get a random point
      let p = [random.value() * w, random.value() * h];
      let size = maxCircleSize;
      let touched = null;
      for (const c of circles) {
        let d = nested ? Math.abs(circleSDF(c, p)) : circleSDF(c, p);
        if (d < size) {
          size = d;
          touched = c;
        }
        if (size <= minCircleSize) {
          // Inside a circle, or circle too small
          break;
        }
      }

      // let d = Math.abs(boxSDF([p[0]-w/2, p[1]-h/2], [w/4,h/4]));
      // if (d < size) {
      //     size = d;
      //     touched = null;
      //   }

      if (size > minCircleSize) {
        let inside = false;
        if (touched) {
          inside = circleSDF(touched, p) < 0;
        }
        circles.push({
          pos: p,
          radius: size,
          id: circles.length,
          touched: touched ? touched.id : -1,
          inside: inside,
        });

        buffer.push(size);
        bufferTotal += size;
        if (buffer.length > maxBuffer) {
          bufferTotal -= buffer.shift();
        }
        attempts = 0;
        let rollingAverage = bufferTotal / maxBuffer;

        if (circles.length % 10 == 0) {
          self.postMessage({
            type: "LOADING",
            num: circles.length,
            total: n,
          });
        }
      }
      attempts++;
    }

    const numGenerated = circles.length;
    let positions = [];
    let radii = new Float32Array(numGenerated);
    // 0 => no touch
    // n => touches circle at index abs(n)-1
    // negative means nested, positive not nested.
    // this may be stupid... trading possible runtime cost to save a few kB of memory
    let touchInfo = new Int32Array(numGenerated);

    for (let i = 0; i < numGenerated; i++) {
      const c = circles[i];
      positions.push(c.pos);
      radii[i] = c.radius;
      let sign = c.inside ? -1 : 1;
      touchInfo[i] = sign * (c.touched + 1);
    }

    self.postMessage({
      type: "DONE",
      n: numGenerated,
      positions,
      radii,
      touchInfo,
    });
  });
};

function transform(p, matrix) {
  const px = p[0];
  const py = p[1];
  const pz = 1;


  
}

function circleSDF(circle, p) {
  //return length([circle.pos[0] - p[0],circle.pos[1] - p[1]]) - circle.radius;
  return dist(circle.pos, p) - circle.radius;
}

function boxSDF([px,py], [bx,by]) {
  const [dx,dy] = [Math.abs(px)-bx, Math.abs(py)-by];
  return len([Math.max(dx,0),Math.max(dy,0)]) + Math.min(Math.max(dx,dy),0);
}

function dist(p, q) {
  const dx = p[0] - q[0];
  const dy = p[1] - q[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function len(p) {
  return Math.sqrt(p[0]*p[0] + p[1]*p[1]);
}