// The image pass: a dark nebula drawn from a tileable noise texture (iChannel1), and Buffer A's comet trails (iChannel0) over it,
// bent a little by the same noise as if seen through haze. A test background for Zaisma's local preview.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 cloudUv = vec2(uv.x * iResolution.x / iResolution.y, uv.y) * 0.7 + vec2(0.0, iTime * 0.004);
  float cloud = texture(iChannel1, cloudUv).r * 0.65 + texture(iChannel1, cloudUv * 2.7 + 0.31).r * 0.35;
  vec2 bend = (vec2(texture(iChannel1, cloudUv * 1.3 + 0.5).r, texture(iChannel1, cloudUv * 1.3 + 0.17).r) - 0.5) * 0.012;
  vec3 trails = texture(iChannel0, uv + bend).rgb;
  vec3 sky = mix(vec3(0.02, 0.025, 0.06), vec3(0.1, 0.05, 0.17), smoothstep(0.3, 0.8, cloud));
  sky += vec3(0.02, 0.06, 0.08) * smoothstep(0.55, 0.95, cloud) * (1.0 + 0.5 * iQuality);
  fragColor = vec4(sky + (1.0 - exp(-trails * 0.9)), 1.0);
}
