// A background that strobes five times a second: the shader check refuses it (shader_flashes).
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float flash = step(0.5, fract(iTime * 5.0));
  fragColor = vec4(mix(vec3(0.05, 0.02, 0.1), vec3(1.0, 0.9, 0.95), flash) * (0.8 + 0.2 * uv.y), 1.0);
}
