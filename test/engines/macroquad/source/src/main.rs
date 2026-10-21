use macroquad::prelude::*;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    fn zaisma_sample_started();
}

const PARTICLE_COUNT: usize = 4000;

struct Particle {
    position: Vec2,
    velocity: Vec2,
    hue: f32,
}

fn window_conf() -> Conf {
    Conf {
        window_title: "macroquad sample".to_owned(),
        high_dpi: true,
        ..Default::default()
    }
}

/// A repeatable pseudo-random number in [0, 1), so the field starts the same every time.
fn hash(seed: u32) -> f32 {
    let mut value = seed.wrapping_mul(747796405).wrapping_add(2891336453);
    value = ((value >> ((value >> 28) + 4)) ^ value).wrapping_mul(277803737);
    ((value >> 22) ^ value) as f32 / u32::MAX as f32
}

#[macroquad::main(window_conf)]
async fn main() {
    let mut particles: Vec<Particle> = (0..PARTICLE_COUNT)
        .map(|index| Particle {
            position: vec2(hash(index as u32 * 2) * 1280.0, hash(index as u32 * 2 + 1) * 720.0),
            velocity: Vec2::ZERO,
            hue: hash(index as u32 + 99991),
        })
        .collect();
    let mut steer = vec2(640.0, 360.0);
    let mut frame_count: u64 = 0;

    loop {
        let delta = get_frame_time().min(0.05);
        let size = vec2(screen_width(), screen_height());

        // The arrow keys move the attractor; the pointer pulls it along when the mouse moves.
        let (pointer_x, pointer_y) = mouse_position();
        let pointer = vec2(pointer_x, pointer_y);
        if is_key_down(KeyCode::Left) { steer.x -= 400.0 * delta; }
        if is_key_down(KeyCode::Right) { steer.x += 400.0 * delta; }
        if is_key_down(KeyCode::Up) { steer.y -= 400.0 * delta; }
        if is_key_down(KeyCode::Down) { steer.y += 400.0 * delta; }
        if is_mouse_button_down(MouseButton::Left) { steer = pointer; }
        steer = steer.clamp(Vec2::ZERO, size);

        let time = get_time() as f32;
        let wander = steer + vec2((time * 0.8).cos(), (time * 1.1).sin()) * 90.0;

        for particle in particles.iter_mut() {
            let toward = wander - particle.position;
            let distance = toward.length().max(30.0);
            particle.velocity += toward / distance * (9000.0 / distance) * delta;
            particle.velocity *= 1.0 - 0.9 * delta;
            particle.position += particle.velocity * delta;
        }

        clear_background(Color::new(0.03, 0.03, 0.06, 1.0));
        for particle in particles.iter() {
            let speed = (particle.velocity.length() / 300.0).min(1.0);
            let color = Color::new(0.35 + 0.6 * particle.hue, 0.45 + 0.5 * speed, 1.0 - 0.5 * particle.hue, 0.85);
            draw_rectangle(particle.position.x, particle.position.y, 2.0, 2.0, color);
        }
        draw_circle(wander.x, wander.y, 6.0, WHITE);
        draw_text(&format!("{} particles   {:.0} fps", PARTICLE_COUNT, get_fps()), 16.0, 28.0, 28.0, WHITE);
        draw_text("Arrow keys or hold the mouse to steer", 16.0, 54.0, 22.0, GRAY);

        next_frame().await;
        frame_count += 1;
        if frame_count == 1 {
            #[cfg(target_arch = "wasm32")]
            unsafe {
                zaisma_sample_started();
            }
        }
    }
}
