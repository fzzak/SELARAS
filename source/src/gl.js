'use strict';
/* =====================================================================================
   A small WebGL renderer: coloured triangle meshes with a depth buffer, an orbit camera
   and a projector for the 2D overlay. No external library, so the page works offline.
   ===================================================================================== */
const M4 = {
  persp(fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far); return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; },
  lookAt(e, c, u) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
  },
  mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; },
};

function createRenderer(canvas) {
  let gl = null;
  try { gl = canvas.getContext('webgl', {antialias: true, alpha: false, preserveDrawingBuffer: true}) || canvas.getContext('experimental-webgl'); } catch (e) { gl = null; }
  if (!gl) return null;
  const uint32 = !!gl.getExtension('OES_element_index_uint');
  const VS = `attribute vec3 aPos; attribute vec4 aCol; attribute vec3 aNor; uniform mat4 uMVP; varying vec4 vCol; varying vec3 vNor; varying float vY;
    void main(){ vCol = aCol; vNor = aNor; vY = aPos.y; gl_Position = uMVP * vec4(aPos, 1.0); }`;
  const FS = `precision mediump float; varying vec4 vCol; varying vec3 vNor; varying float vY; uniform float uLit; uniform float uFloor; uniform vec3 uLight;
    void main(){ if (vY < uFloor) discard; vec3 c = vCol.rgb;
      if (uLit > 0.5) { float d = max(dot(normalize(vNor), uLight), 0.0); c *= (0.50 + 0.62 * d); }
      gl_FragColor = vec4(c, vCol.a); }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const loc = {pos: gl.getAttribLocation(prog, 'aPos'), col: gl.getAttribLocation(prog, 'aCol'), nor: gl.getAttribLocation(prog, 'aNor'),
    mvp: gl.getUniformLocation(prog, 'uMVP'), lit: gl.getUniformLocation(prog, 'uLit'), floor: gl.getUniformLocation(prog, 'uFloor'), light: gl.getUniformLocation(prog, 'uLight')};
  const meshes = new Map();
  const cam = {az: -0.5, el: 0.55, dist: 3.4, tx: 0, ty: -0.25, tz: 0, fov: 32 * Math.PI / 180};
  let W = 1, H = 1, dpr = 1, mvp = M4.persp(cam.fov, 1, 0.05, 50), bg = [0.04, 0.055, 0.075];

  function setMesh(name, m) {                    // m: {pos:Float32Array, col:Uint8Array, nor?:Float32Array, idx:Uint16Array|Uint32Array, lit, blend, order}
    removeMesh(name); if (!m || !m.idx || !m.idx.length) return;
    let idx = m.idx;
    if (idx instanceof Uint32Array && !uint32) { if (m.pos.length / 3 > 65535) return; idx = Uint16Array.from(idx); }
    const buf = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    meshes.set(name, {pos: buf(gl.ARRAY_BUFFER, m.pos), col: buf(gl.ARRAY_BUFFER, m.col), nor: m.nor ? buf(gl.ARRAY_BUFFER, m.nor) : null,
      idx: buf(gl.ELEMENT_ARRAY_BUFFER, idx), n: idx.length, type: idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, lit: !!m.lit, blend: !!m.blend, order: m.order || 0});
  }
  function removeMesh(name) { const m = meshes.get(name); if (!m) return; [m.pos, m.col, m.nor, m.idx].forEach(b => b && gl.deleteBuffer(b)); meshes.delete(name); }
  function resize(w, h, ratio) { W = Math.max(1, w); H = Math.max(1, h); dpr = ratio; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  function eye() { const ce = Math.cos(cam.el); return [cam.tx + cam.dist * ce * Math.sin(cam.az), cam.ty + cam.dist * Math.sin(cam.el), cam.tz + cam.dist * ce * Math.cos(cam.az)]; }
  function draw(floorY) {
    mvp = M4.mul(M4.persp(cam.fov, W / H, 0.05, 60), M4.lookAt(eye(), [cam.tx, cam.ty, cam.tz], [0, 1, 0]));
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.uniformMatrix4fv(loc.mvp, false, new Float32Array(mvp)); gl.uniform1f(loc.floor, floorY);
    const L = [0.45, 0.8, 0.4], l = Math.hypot(...L); gl.uniform3f(loc.light, L[0] / l, L[1] / l, L[2] / l);
    const list = [...meshes.values()].sort((a, b) => (a.blend - b.blend) || (a.order - b.order));
    for (const m of list) {
      if (m.blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); } else { gl.disable(gl.BLEND); gl.depthMask(true); }
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.col); gl.enableVertexAttribArray(loc.col); gl.vertexAttribPointer(loc.col, 4, gl.UNSIGNED_BYTE, true, 0, 0);
      if (m.nor) { gl.bindBuffer(gl.ARRAY_BUFFER, m.nor); gl.enableVertexAttribArray(loc.nor); gl.vertexAttribPointer(loc.nor, 3, gl.FLOAT, false, 0, 0); }
      else { gl.disableVertexAttribArray(loc.nor); gl.vertexAttrib3f(loc.nor, 0, 1, 0); }
      gl.uniform1f(loc.lit, m.lit && m.nor ? 1 : 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx); gl.drawElements(gl.TRIANGLES, m.n, m.type, 0);
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  function project(x, y, z) {                   // scene point -> [css x, css y, visible]
    const w = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15]; if (w <= 0.0001) return [0, 0, false];
    const cx = (mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]) / w, cy = (mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]) / w;
    return [(cx * 0.5 + 0.5) * W, (1 - (cy * 0.5 + 0.5)) * H, true];
  }
  function pan(dx, dy) {                        // move the target in the view plane by css pixels
    const k = 2 * cam.dist * Math.tan(cam.fov / 2) / H, sa = Math.sin(cam.az), ca = Math.cos(cam.az);
    cam.tx += (-dx * ca) * k; cam.tz += (dx * sa) * k; cam.ty += dy * k * Math.cos(cam.el);
    cam.tx -= dy * k * Math.sin(cam.el) * sa; cam.tz -= dy * k * Math.sin(cam.el) * ca;
  }
  return {gl, cam, setMesh, removeMesh, resize, draw, project, pan, eye, setBg: c => { bg = c; }, get size() { return [W, H]; }};
}

/* ---------- colour ---------------------------------------------------------------- */
const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgbCss = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
function makeRamp(stops) {                      // stops: [[t, '#hex'], ...] -> function(t) -> [r,g,b]
  const S = stops.map(([t, h]) => [t, hex2rgb(h)]);
  return t => { t = t < 0 ? 0 : t > 1 ? 1 : (Number.isNaN(t) ? 0 : t); for (let i = 1; i < S.length; i++) if (t <= S[i][0]) return mix(S[i - 1][1], S[i][1], (t - S[i - 1][0]) / (S[i][0] - S[i - 1][0] || 1)); return S[S.length - 1][1]; };
}
function hueRamp(hue) {                         // one hue, dark (low) to light (high), tuned for the dark scene
  const h = hex2rgb(hue), lo = mix(h, [10, 14, 20], 0.62), hi = mix(h, [255, 255, 255], 0.82);
  const toHex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  return makeRamp([[0, toHex(lo)], [0.5, hue], [1, toHex(hi)]]);
}
