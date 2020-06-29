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

vec3 palette( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d ) {
    return a + b*cos( 6.28318*(c*t+d) );
}

void main() {
    vColor = palette( paletteIndex, vec3(0.5,0.5,0.5),vec3(0.5,0.5,0.5),vec3(1.0,1.0,1.0),vec3(0.0,0.1,0.2) );//vec3(paletteIndex, 0, 0);
    // 2 * position/resolution.xy - 1
    gl_Position = vec4(2. * (position + radius*quadPoint)/resolution - 1., 0, 1);

    vUv = uv;
}