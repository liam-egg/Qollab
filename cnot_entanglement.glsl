// =====================================================================
//  "Where did the qubit go?"  —  a CNOT gate creating entanglement
//  Shadertoy, Image tab, no channels. Drag the mouse horizontally to scrub the gate.
//
//  THE PROCESS
//  Start in |+>|0> = (|00> + |10>)/sqrt2 and apply a CNOT *continuously*
//  (the fractional gate CNOT^s, s: 0 -> 1). At s = 1 you get the Bell state
//  (|00> + |11>)/sqrt2.
//
//  WHY IT'S HARD TO SEE
//  Single-qubit gates are rotations of a Bloch sphere. A two-qubit
//  entangling gate is not: the joint state no longer factors into one
//  sphere per qubit. Each qubit's *own* state (its reduced density matrix)
//  shrinks from the sphere's surface into its interior. At full
//  entanglement both arrows have length zero: the information hasn't been
//  lost, it now lives only in the correlations between the qubits.
//
//  WHAT'S ON SCREEN
//  Left  : the 4 complex amplitudes |00>,|01>,|10>,|11> as phasors.
//          disk size = |amplitude|, hand + colour = phase.
//          The dots under each cell are the basis label (filled = 1):
//          orange = control qubit, blue = target qubit.
//  Right : the two reduced Bloch spheres (orange = control, blue = target).
//          Bright arrow = actual local Bloch vector r.
//          Faint inner ball = |r| (local purity left over).
//          Hollow ring = where a pure state with that direction would sit.
//  Middle: the strands between the spheres glow with the concurrence C,
//          a standard entanglement measure. For a pure state |r|^2 + C^2 = 1,
//          so as the arrows shrink, the strands brighten exactly in step.
//  Bottom: CNOT symbol + gate progress bar.
//
//  Everything is computed from the amplitudes (partial traces done in the
//  shader), not hard-coded, so the picture is the real maths.
// =====================================================================

#define PI  3.14159265359
#define TAU 6.28318530718

// ---------- complex helpers ----------
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 cconj(vec2 a){ return vec2(a.x, -a.y); }
vec2 cis(float t){ return vec2(cos(t), sin(t)); }

// ---------- the physics ----------
// Fractional CNOT^s on |+>|0>.  X^s = e^{i*pi*s/2} (cos(pi*s/2) I - i sin(pi*s/2) X)
// acts on the target only when the control is |1>.
void evolve(float s, out vec2 a[4]){
    float r = 0.70710678;
    float h = 0.5 * PI * s;
    a[0] = vec2(r, 0.0);                              // |00>
    a[1] = vec2(0.0);                                 // |01>
    a[2] = r * cmul(cis(h), vec2(cos(h), 0.0));       // |10>
    a[3] = r * cmul(cis(h), vec2(0.0, -sin(h)));      // |11>
}

// rho = (I + r.sigma)/2  ->  rho01 = (rx - i ry)/2
// Control qubit: partial trace over target.
vec3 blochControl(vec2 a[4]){
    vec2 p = cmul(a[0], cconj(a[2])) + cmul(a[1], cconj(a[3]));
    float z = dot(a[0],a[0]) + dot(a[1],a[1]) - dot(a[2],a[2]) - dot(a[3],a[3]);
    return vec3(2.0*p.x, -2.0*p.y, z);
}
// Target qubit: partial trace over control.
vec3 blochTarget(vec2 a[4]){
    vec2 p = cmul(a[0], cconj(a[1])) + cmul(a[2], cconj(a[3]));
    float z = dot(a[0],a[0]) + dot(a[2],a[2]) - dot(a[1],a[1]) - dot(a[3],a[3]);
    return vec3(2.0*p.x, -2.0*p.y, z);
}
// Concurrence of a pure two-qubit state: C = 2|a00 a11 - a01 a10|
float concurrence(vec2 a[4]){
    return 2.0 * length(cmul(a[0], a[3]) - cmul(a[1], a[2]));
}

// ---------- drawing helpers ----------
vec3 hue(float t){ return 0.5 + 0.5*cos(t + vec3(0.0, 2.094, 4.188)); }

float sdSeg(vec2 p, vec2 a, vec2 b){
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return length(pa - ba*h);
}
float fillAA(float d, float px){ return 1.0 - smoothstep(-px, px, d); }
float strokeAA(float d, float w, float px){ return 1.0 - smoothstep(w - px, w + px, abs(d)); }

// 3D -> screen. Bloch convention: z up (|0> at top). Viewer slightly above.
// returns (screen x, screen y, depth toward viewer)
vec3 proj(vec3 p, float yaw, float pitch){
    float c = cos(yaw), s = sin(yaw);
    vec3 q = vec3(c*p.x - s*p.y, s*p.x + c*p.y, p.z);
    float cp = cos(pitch), sp = sin(pitch);
    return vec3(q.x, q.y*sp + q.z*cp, -q.y*cp + q.z*sp);
}

// distance to a projected great circle; .y = depth of nearest piece (front/back)
vec2 greatCircle(vec2 p, vec2 c, float R, int axis, float yaw, float pitch){
    float best = 1e9, dep = 0.0;
    vec2 prev = vec2(0.0);
    for(int i = 0; i <= 40; i++){
        float th = TAU * float(i) / 40.0;
        vec3 q = axis == 0 ? vec3(cos(th), sin(th), 0.0)
               : axis == 1 ? vec3(cos(th), 0.0, sin(th))
                           : vec3(0.0, cos(th), sin(th));
        vec3 s = proj(q, yaw, pitch);
        vec2 sp = c + R * s.xy;
        if(i > 0){
            float d = sdSeg(p, prev, sp);
            if(d < best){ best = d; dep = s.z; }
        }
        prev = sp;
    }
    return vec2(best, dep);
}

void drawBloch(inout vec3 col, vec2 p, vec2 c, float R, vec3 r, vec3 tint,
               float yaw, float pitch, float px){
    float d = length(p - c);
    if(d > R * 1.25) return;

    // sphere body with soft shading
    vec2 n2 = (p - c) / R;
    float nz = sqrt(max(0.0, 1.0 - dot(n2, n2)));
    col = mix(col, col + tint * (0.04 + 0.08*nz), fillAA(d - R, px));

    // the "purity ball": radius |r|
    float len = length(r);
    col += tint * 0.16 * fillAA(d - R*len, px);
    col += tint * 0.35 * strokeAA(d - R*len, 0.0012, px);

    // wireframe: equator + two meridians, back halves dimmer
    for(int k = 0; k < 3; k++){
        vec2 gc = greatCircle(p, c, R, k, yaw, pitch);
        float a = gc.y > 0.0 ? 0.30 : 0.08;
        col += vec3(0.65, 0.72, 0.9) * a * strokeAA(gc.x, 0.0010, px);
    }
    // outline
    col += tint * 0.55 * strokeAA(d - R, 0.0016, px);

    // poles |0> (top) and |1> (bottom)
    vec2 north = c + R * proj(vec3(0,0, 1), yaw, pitch).xy;
    vec2 south = c + R * proj(vec3(0,0,-1), yaw, pitch).xy;
    col += vec3(0.8) * fillAA(length(p - north) - 0.006, px);
    col += vec3(0.8) * strokeAA(length(p - south) - 0.006, 0.0012, px);

    // ghost: pure-state direction (fades as the vector vanishes)
    if(len > 1e-3){
        vec2 g = c + R * proj(r / len, yaw, pitch).xy;
        float vis = smoothstep(0.0, 0.15, len);
        col += tint * 0.5 * vis * strokeAA(length(p - g) - 0.012, 0.0014, px);
        col += tint * 0.18 * vis * strokeAA(sdSeg(p, c + R*len*(g - c)/R, g), 0.0008, px);
    }

    // actual Bloch vector
    vec2 tip = c + R * proj(r, yaw, pitch).xy;
    float arrow = strokeAA(sdSeg(p, c, tip), 0.0035, px);
    col = mix(col, tint * 1.4, arrow);
    col = mix(col, vec3(1.0), fillAA(length(p - tip) - 0.008, px) * smoothstep(0.0, 0.05, len));
}

void bitDot(inout vec3 col, vec2 p, vec2 c, bool one, vec3 tint, float px){
    float d = length(p - c) - 0.009;
    col = mix(col, tint, one ? fillAA(d, px) : strokeAA(d, 0.0016, px));
}

// ---------- main ----------
void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 p  = (fragCoord - 0.5*iResolution.xy) / iResolution.y;
    float px = 1.5 / iResolution.y;

    // gate progress: hold, apply, hold, un-apply
    float T = mod(iTime, 10.0);
    float s = smoothstep(1.0, 4.5, T) * (1.0 - smoothstep(6.0, 9.5, T));
    if(iMouse.z > 0.0) s = clamp(iMouse.x / iResolution.x, 0.0, 1.0);

    vec2 a[4];
    evolve(s, a);
    vec3  rA = blochControl(a);
    vec3  rB = blochTarget(a);
    float C  = concurrence(a);

    vec3 tintA = vec3(1.0, 0.55, 0.22);   // control
    vec3 tintB = vec3(0.30, 0.75, 1.0);   // target

    // background
    vec3 col = mix(vec3(0.020, 0.025, 0.045), vec3(0.05, 0.05, 0.09), 0.5 + 0.5*p.y);
    col *= 1.0 - 0.35 * dot(p, p);

    // ---------- amplitude phasors ----------
    vec2 gc = vec2(-0.42, 0.04);
    float sp = 0.155, Rc = 0.115;
    // correlation glow along the |00>-|11> diagonal
    {
        vec2 c00 = gc + vec2(-sp,  sp), c11 = gc + vec2(sp, -sp);
        float dd = sdSeg(p, c00, c11);
        col += mix(tintA, tintB, 0.5) * C * 0.25 * exp(-dd*dd*900.0);
    }
    for(int i = 0; i < 4; i++){
        bool ctl = i >= 2, tgt = (i == 1 || i == 3);
        vec2 cc = gc + vec2(tgt ? sp : -sp, ctl ? -sp : sp);
        float d   = length(p - cc);
        float mag = length(a[i]) / 0.70710678;
        float ph  = atan(a[i].y, a[i].x);

        col += vec3(0.22) * strokeAA(d - Rc, 0.0012, px);                       // max ring
        col += vec3(0.35) * strokeAA(sdSeg(p, cc + vec2(Rc,0), cc + vec2(Rc*1.12,0)), 0.001, px); // phase 0 tick
        col = mix(col, hue(ph) * 0.6, 0.85 * fillAA(d - Rc*mag, px));           // |amplitude|
        col += hue(ph) * 0.6 * strokeAA(d - Rc*mag, 0.0015, px) * step(0.01, mag);
        float hand = strokeAA(sdSeg(p, cc, cc + Rc*mag*cis(ph)), 0.0028, px);   // phase
        col = mix(col, vec3(1.0), hand * step(0.01, mag));

        vec2 lb = cc + vec2(0.0, -Rc - 0.03);
        bitDot(col, p, lb + vec2(-0.016, 0.0), ctl, tintA, px);
        bitDot(col, p, lb + vec2( 0.016, 0.0), tgt, tintB, px);
    }

    // ---------- reduced Bloch spheres ----------
    float yaw = 0.7 + 0.25 * iTime, pitch = 0.38, R = 0.16;
    vec2 cA = vec2(0.40, 0.245), cB = vec2(0.40, -0.245);

    // entanglement strands between the spheres, brightness = concurrence
    {
        float y0 = cB.y + R, y1 = cA.y - R;
        if(p.y > y0 - 0.02 && p.y < y1 + 0.02){
            float u = clamp((p.y - y0) / (y1 - y0), 0.0, 1.0);
            float env = sin(PI * u);
            vec3 tc = mix(tintB, tintA, u);
            for(int k = 0; k < 3; k++){
                float x = cA.x + env * 0.06 * sin(TAU*u*1.5 + iTime*3.0 + float(k)*2.094);
                col += tc * C * strokeAA(p.x - x, 0.0016, px);
                col += tc * C * 0.15 * exp(-pow((p.x - x)*60.0, 2.0));
            }
        }
    }
    drawBloch(col, p, cA, R, rA, tintA, yaw, pitch, px);
    drawBloch(col, p, cB, R, rB, tintB, yaw, pitch, px);

    // ---------- CNOT symbol ----------
    {
        vec2 ic = vec2(-0.42, -0.375);
        float wy0 = ic.y + 0.035, wy1 = ic.y - 0.035;
        float act = 0.35 + 0.65 * s;
        col += vec3(0.4) * strokeAA(sdSeg(p, vec2(ic.x-0.09, wy0), vec2(ic.x+0.09, wy0)), 0.0012, px);
        col += vec3(0.4) * strokeAA(sdSeg(p, vec2(ic.x-0.09, wy1), vec2(ic.x+0.09, wy1)), 0.0012, px);
        col += tintA * act * fillAA(length(p - vec2(ic.x, wy0)) - 0.011, px);       // control dot
        vec2 tc = vec2(ic.x, wy1);                                                   // target (+)
        col += tintB * act * strokeAA(length(p - tc) - 0.02, 0.0018, px);
        col += tintB * act * strokeAA(sdSeg(p, tc - vec2(0.02,0), tc + vec2(0.02,0)), 0.0016, px);
        col += vec3(0.8) * act * strokeAA(sdSeg(p, vec2(ic.x, wy0), vec2(ic.x, wy1 - 0.02)), 0.0016, px);
    }

    // ---------- progress bar ----------
    {
        float x0 = -0.8, x1 = 0.8, by = -0.465;
        float xs = mix(x0, x1, s);
        col += vec3(0.18) * strokeAA(sdSeg(p, vec2(x0, by), vec2(x1, by)), 0.002, px);
        col += mix(tintA, tintB, s) * strokeAA(sdSeg(p, vec2(x0, by), vec2(xs, by)), 0.003, px);
        col += vec3(1.0) * fillAA(length(p - vec2(xs, by)) - 0.007, px);
    }

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
