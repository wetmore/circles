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
    alpha = 1.0 - smoothstep(1.0-delta/2., 1.0+delta/2., r);
    #endif
    //alpha = 1. - step(1.,r); // no antialias

    gl_FragColor = vec4(vColor, alpha);
    gl_FragColor.rgb *= gl_FragColor.a;
}
