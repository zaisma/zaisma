use std::f32::consts::TAU;

use bevy::{
    input::mouse::AccumulatedMouseMotion,
    prelude::*,
    window::WindowResolution,
};

const CUBE_COUNT: usize = 24;
const RING_RADIUS: f32 = 4.0;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Bevy sample".into(),
                canvas: Some("#bevy".into()),
                fit_canvas_to_parent: true,
                prevent_default_event_handling: true,
                resolution: WindowResolution::new(1280, 720),
                ..default()
            }),
            ..default()
        }))
        .insert_resource(ClearColor(Color::srgb(0.04, 0.05, 0.09)))
        .add_systems(Startup, setup)
        .add_systems(Update, (spin_cubes, orbit_camera, report_started))
        .run();
}

/// A cube in the ring: where it sits around the ring, and how fast it spins.
#[derive(Component)]
struct RingCube {
    angle: f32,
    spin_speed: f32,
}

/// The camera's place on a sphere around the middle of the scene.
#[derive(Component)]
struct OrbitCamera {
    azimuth: f32,
    inclination: f32,
    radius: f32,
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let cube_mesh = meshes.add(Cuboid::new(0.8, 0.8, 0.8));
    for index in 0..CUBE_COUNT {
        let angle = index as f32 / CUBE_COUNT as f32 * TAU;
        commands.spawn((
            Mesh3d(cube_mesh.clone()),
            MeshMaterial3d(materials.add(Color::hsl(angle.to_degrees(), 0.7, 0.6))),
            Transform::from_xyz(angle.cos() * RING_RADIUS, 1.0, angle.sin() * RING_RADIUS),
            RingCube { angle, spin_speed: 0.6 + (index % 5) as f32 * 0.25 },
        ));
    }

    commands.spawn((
        Mesh3d(meshes.add(Plane3d::default().mesh().size(20.0, 20.0))),
        MeshMaterial3d(materials.add(Color::srgb(0.22, 0.24, 0.3))),
    ));

    commands.spawn((
        PointLight {
            shadow_maps_enabled: true,
            intensity: 3_000_000.0,
            range: 60.0,
            ..default()
        },
        Transform::from_xyz(0.0, 9.0, 0.0),
    ));

    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(0.0, 6.0, 10.0).looking_at(Vec3::ZERO, Vec3::Y),
        OrbitCamera { azimuth: TAU / 4.0, inclination: 1.0, radius: 12.0 },
    ));
}

/// Cubes spin on themselves and bob up and down around the ring.
fn spin_cubes(time: Res<Time>, mut cubes: Query<(&mut Transform, &RingCube)>) {
    let elapsed = time.elapsed_secs();
    for (mut transform, cube) in &mut cubes {
        transform.rotation = Quat::from_rotation_y(elapsed * cube.spin_speed) * Quat::from_rotation_x(elapsed * 0.5);
        transform.translation.y = 1.2 + (elapsed * 1.5 + cube.angle * 3.0).sin() * 0.6;
    }
}

/// The arrow keys, or a drag with the left mouse button, turn the camera around the ring.
fn orbit_camera(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    buttons: Res<ButtonInput<MouseButton>>,
    motion: Res<AccumulatedMouseMotion>,
    mut cameras: Query<(&mut Transform, &mut OrbitCamera)>,
) {
    for (mut transform, mut orbit) in &mut cameras {
        let step = time.delta_secs();
        if keys.pressed(KeyCode::ArrowLeft) { orbit.azimuth -= 1.5 * step; }
        if keys.pressed(KeyCode::ArrowRight) { orbit.azimuth += 1.5 * step; }
        if keys.pressed(KeyCode::ArrowUp) { orbit.inclination -= 1.0 * step; }
        if keys.pressed(KeyCode::ArrowDown) { orbit.inclination += 1.0 * step; }
        if buttons.pressed(MouseButton::Left) {
            orbit.azimuth += motion.delta.x * 0.005;
            orbit.inclination += motion.delta.y * 0.005;
        }
        orbit.inclination = orbit.inclination.clamp(0.2, 1.4);
        let position = Vec3::new(
            orbit.inclination.sin() * orbit.azimuth.cos(),
            orbit.inclination.cos(),
            orbit.inclination.sin() * orbit.azimuth.sin(),
        ) * orbit.radius;
        *transform = Transform::from_translation(position).looking_at(Vec3::ZERO, Vec3::Y);
    }
}

/// Once the first frame has rendered, tells the page the game started (for Zaisma's engine samples test).
fn report_started(mut frame_count: Local<u32>, mut has_reported: Local<bool>) {
    if *has_reported {
        return;
    }
    *frame_count += 1;
    // The first frames are only queued; a few later, one has been drawn.
    if *frame_count < 3 {
        return;
    }
    *has_reported = true;
    #[cfg(target_arch = "wasm32")]
    if let Some(window) = web_sys::window() {
        use wasm_bindgen::JsValue;
        let sample = js_sys::Object::new();
        for (key, value) in [("engine", JsValue::from_str("bevy")), ("version", JsValue::from_str("0.20.0")), ("started", JsValue::TRUE)] {
            let _ = js_sys::Reflect::set(&sample, &JsValue::from_str(key), &value);
        }
        let _ = js_sys::Reflect::set(&window, &JsValue::from_str("zaismaEngineSample"), &sample);
    }
}
