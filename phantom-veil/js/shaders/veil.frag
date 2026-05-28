// Veil fragment shader — refraction + moiré on webcam feed
precision mediump float;

varying vec2 v_texCoord;
uniform sampler2D u_webcam;
uniform sampler2D u_clothData;  // cloth vertex displacements (cols × rows, RG: dx,dy)
uniform float u_mirror;
uniform vec2 u_clothTexSize;    // texture dimensions (cols, rows)
uniform vec2 u_clothBounds;     // cloth position + size in screen UV: (startU, startV, widthU, heightV)
uniform float u_time;
uniform float u_refractionStrength; // 1-2px at rest, 5-8px when pulled (in UV units)
uniform float u_moireIntensity;     // 0.03 at rest, 0.08 when pulled

void main() {
  vec2 uv = v_texCoord;
  if (u_mirror > 0.5) {
    uv.x = 1.0 - uv.x;
  }

  // Sample cloth displacement at this screen position
  // Map screen UV to cloth texture UV
  vec2 clothUV = (uv - u_clothBounds.xy) / u_clothBounds.zw;
  vec4 clothSample = texture2D(u_clothData, clothUV);
  vec2 displacement = clothSample.rg; // dx, dy in pixels (encoded)

  // Refraction: offset UV by displacement
  vec2 refractedUV = uv + displacement * u_refractionStrength;

  // Moiré pattern: fine diagonal lines
  float moireFreq = 80.0; // lines per screen
  float moire = sin(refractedUV.x * moireFreq) * sin(refractedUV.y * moireFreq * 1.3);
  moire = abs(moire) * u_moireIntensity;

  // Sample webcam at refracted position
  vec4 color = texture2D(u_webcam, refractedUV);

  // Add moiré overlay
  color.rgb += moire * 0.5;

  // Soft vignette at edges (cloth boundary)
  float edgeFade = smoothstep(0.0, 0.05, clothUV.x) * smoothstep(0.0, 0.05, clothUV.y)
                 * smoothstep(0.0, 0.05, 1.0 - clothUV.x) * smoothstep(0.0, 0.05, 1.0 - clothUV.y);

  gl_FragColor = color;
}
