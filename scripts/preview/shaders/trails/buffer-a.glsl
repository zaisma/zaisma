// Buffer A: comets of light whose trails stay from frame to frame. Each frame it reads its own last frame (iChannel0), lets it
// drift up a little and fade (about half its light goes in a second and a quarter), and adds each comet's glow where it is now.
// More comets on faster devices: iQuality is 0 on phones, 1 on tablets, 2 on computers.
vec3 cometColor(float index) {
  return 0.55 + 0.45 * cos(6.2831 * (index * 0.137 + vec3(0.0, 0.33, 0.67)));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 trails = texture(iChannel0, uv - vec2(0.0, 0.03 * iTimeDelta)).rgb * pow(0.5, iTimeDelta * 0.8);
  vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float halfWidth = 0.5 * iResolution.x / iResolution.y;
  int cometCount = 4 + 3 * int(iQuality);
  for (int i = 0; i < 10; i++) {
    if (i >= cometCount) break;
    float index = float(i), speed = 0.22 + 0.06 * mod(index * 7.0, 5.0);
    vec2 at = vec2(halfWidth * 0.8 * sin(iTime * speed + index * 2.1), 0.42 * sin(iTime * speed * 0.73 + index * 1.3));
    vec2 toComet = p - at;
    trails += cometColor(index) * (0.00012 / (dot(toComet, toComet) + 0.00008)) * iTimeDelta * 10.0;
  }
  fragColor = vec4(min(trails, vec3(4.0)), 1.0);
}
