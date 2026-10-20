# A Godot sample for Zaisma's engine tests: a lit 3D scene with shadows and physics. Boxes rain onto
# a floor and pile up, the camera orbits with the arrow keys or a drag, and the best pile height is kept
# in the game's own save (user://, which Godot keeps in the browser's IndexedDB).
extends Node3D

const SAVE_PATH := "user://best.save"
var camera: Camera3D
var yaw := 0.6
var spawn_timer := 0.0
var box_count := 0
var best_box_count := 0

func _ready() -> void:
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.06, 0.07, 0.1)
	environment.ambient_light_color = Color(0.4, 0.45, 0.55)
	environment.ambient_light_energy = 0.6
	var world := WorldEnvironment.new()
	world.environment = environment
	add_child(world)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, 35, 0)
	sun.shadow_enabled = true
	add_child(sun)

	var floor_body := StaticBody3D.new()
	var floor_shape := CollisionShape3D.new()
	floor_shape.shape = BoxShape3D.new()
	floor_shape.shape.size = Vector3(30, 1, 30)
	floor_body.add_child(floor_shape)
	var floor_mesh := MeshInstance3D.new()
	floor_mesh.mesh = BoxMesh.new()
	floor_mesh.mesh.size = Vector3(30, 1, 30)
	floor_mesh.material_override = _material(Color(0.18, 0.22, 0.28))
	floor_body.add_child(floor_mesh)
	floor_body.position.y = -0.5
	add_child(floor_body)

	camera = Camera3D.new()
	add_child(camera)

	if FileAccess.file_exists(SAVE_PATH):
		best_box_count = FileAccess.open(SAVE_PATH, FileAccess.READ).get_32()
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.zaismaEngineSample = { engine: 'godot', version: '%s', started: true }" % Engine.get_version_info().string)

func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	return material

func _drop_box() -> void:
	var body := RigidBody3D.new()
	var shape := CollisionShape3D.new()
	shape.shape = BoxShape3D.new()
	body.add_child(shape)
	var mesh := MeshInstance3D.new()
	mesh.mesh = BoxMesh.new()
	mesh.material_override = _material(Color.from_hsv(randf(), 0.5, 0.9))
	body.add_child(mesh)
	body.position = Vector3(randf_range(-3, 3), 12, randf_range(-3, 3))
	body.rotation = Vector3(randf(), randf(), randf())
	add_child(body)
	box_count += 1
	if box_count > best_box_count:
		best_box_count = box_count
		FileAccess.open(SAVE_PATH, FileAccess.WRITE).store_32(best_box_count)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and event.button_mask & MOUSE_BUTTON_MASK_LEFT:
		yaw -= event.relative.x * 0.005
	if event is InputEventScreenDrag:
		yaw -= event.relative.x * 0.005

func _process(delta: float) -> void:
	yaw += (Input.get_action_strength("ui_left") - Input.get_action_strength("ui_right")) * delta * 1.5
	camera.position = Vector3(sin(yaw) * 16, 9, cos(yaw) * 16)
	camera.look_at(Vector3(0, 1, 0))
	spawn_timer -= delta
	if spawn_timer <= 0 and box_count < 120:
		spawn_timer = 0.25
		_drop_box()
