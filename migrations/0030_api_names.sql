-- Choice values are snake_case (docs/NAMING.md): the keyboard-and-mouse control is keyboard_mouse.
UPDATE games SET controls = REPLACE(controls, 'keyboard-mouse', 'keyboard_mouse') WHERE controls LIKE '%keyboard-mouse%';
