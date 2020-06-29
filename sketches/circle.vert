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
}