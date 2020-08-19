'use strict';
const {app, BrowserWindow} = require('electron');
const isAccelerator = require('electron-is-accelerator');
const equals = require('keyboardevents-areequal');
const {toKeyEvent} = require('keyboardevent-from-electron-accelerator');
const _debug = require('debug');

const debug = _debug('electron-localshortcut');

// A placeholder to register shortcuts
// on any window of the app.
const ANY_WINDOW = {};

const windowsWithShortcuts = new WeakMap();
// NOTE(@averyyip): windowsWithShortcuts.get(wc) returns object of states mapping to shortcutsOfWindow
/*
 * TODO
 * save current hotkeys and restore later (like git stash and git stash apply)
 * register hotkeys for state and window
 * enable hotkeys only for given state
 */


const title = win => {
	if (win) {
		try {
			return win.getTitle();
		// eslint-disable-next-line no-unused-vars
		} catch (error) {
			return 'A destroyed window';
		}
	}

	return 'An falsy value';
};

function _checkAccelerator(accelerator) {
	if (!isAccelerator(accelerator)) {
		const w = {};
		Error.captureStackTrace(w);
		const stack = w.stack ? w.stack.split('\n').slice(4).join('\n') : w.message;
		const msg = `
WARNING: ${accelerator} is not a valid accelerator.

${stack}
`;
		console.error(msg);
	}
}

/**
 * Disable all of the shortcuts registered on the BrowserWindow instance.
 * Registered shortcuts no more works on the `window` instance, but the module
 * keep a reference on them. You can reactivate them later by calling `enableAll`
 * method on the same window instance.
 * @param  {BrowserWindow} win BrowserWindow instance
 */
function disableAll(win) {
	debug(`Disabling all shortcuts on window ${title(win)}`);
	const wc = win.webContents;
	const shortcutsOfWindowByState = windowsWithShortcuts.get(wc);

	for (const state in shortcutsOfWindowByState) {
		for (const shortcut of shortcutsOfWindowByState[state]) {
			shortcut.enabled = false;
		}
	}
}

/**
 * Enable all of the shortcuts registered on the BrowserWindow instance that
 * you had previously disabled calling `disableAll` method.
 * @param  {BrowserWindow} win BrowserWindow instance
 */
function enableAll(win) {
	debug(`Enabling all shortcuts on window ${title(win)}`);
	const wc = win.webContents;
	const shortcutsOfWindowByState = windowsWithShortcuts.get(wc);

	for (const state in shortcutsOfWindowByState) {
		for (const shortcut of shortcutsOfWindowByState[state]) {
			shortcut.enabled = true;
		}
	}
}

/**
 * Unregisters all of the shortcuts registered on any focused BrowserWindow
 * instance. This method does not unregister any shortcut you registered on
 * a particular window instance.
 * @param  {BrowserWindow} win BrowserWindow instance
 */
function unregisterAll(win) {
	debug(`Unregistering all shortcuts on window ${title(win)}`);
	const wc = win.webContents;
	const shortcutsOfWindowByState = windowsWithShortcuts.get(wc);

	for (const state in shortcutsOfWindowByState) {
		const shortcutsOfWindow = shortcutsOfWindowByState[state];
		if (shortcutsOfWindow && shortcutsOfWindow.removeListener) {
			// Remove listener from window
			shortcutsOfWindow.removeListener();
		}
	}
	windowsWithShortcuts.delete(wc);
}

function _normalizeEvent(input) {
	const normalizedEvent = {
		code: input.code,
		key: input.key
	};

	['alt', 'shift', 'meta'].forEach(prop => {
		if (typeof input[prop] !== 'undefined') {
			normalizedEvent[`${prop}Key`] = input[prop];
		}
	});

	if (typeof input.control !== 'undefined') {
		normalizedEvent.ctrlKey = input.control;
	}

	return normalizedEvent;
}

function _findShortcut(event, shortcutsOfWindow) {
	let i = 0;
	for (const shortcut of shortcutsOfWindow) {
		if (equals(shortcut.eventStamp, event)) {
			return i;
		}

		i++;
	}

	return -1;
}

const _onBeforeInput = shortcutsOfWindow => (e, input) => {
	// NOTE(@averyyip): For any input to window, check if it matches shortcut
	if (input.type === 'keyUp') {
		return;
	}

	const event = _normalizeEvent(input);

	debug(`before-input-event: ${input} is translated to: ${event}`);
	for (const {eventStamp, callback} of shortcutsOfWindow) {
		if (equals(eventStamp, event)) {
			debug(`eventStamp: ${eventStamp} match`);
			callback();

			return;
		}

		debug(`eventStamp: ${eventStamp} no match`);
	}
};

/**
 * Registers the shortcut `accelerator`on the BrowserWindow instance.
 * @param  {BrowserWindow} win - BrowserWindow instance to register.
 * This argument could be omitted, in this case the function register
 * the shortcut on all app windows.
 * @param  {String} state - the name of the state
 * @param  {String|Array<String>} accelerator - the shortcut to register
 * @param  {Function} callback    This function is called when the shortcut is pressed
 * and the window is focused and not minimized.
 */
function register(win, state, accelerator, callback) {
	// NOTE(@averyyip) Add additional param called stateName, and register for win & state
	let wc;
	if (typeof callback === 'undefined') {
		wc = ANY_WINDOW;
		callback = accelerator;
		accelerator = win;
	} else {
		wc = win.webContents;
	}

	if (Array.isArray(accelerator) === true) {
		accelerator.forEach(accelerator => {
			if (typeof accelerator === 'string') {
				register(win, state, accelerator, callback);
			}
		});
		return;
	}

	debug(`Registering callback for ${accelerator} on window ${title(win)}`);
	_checkAccelerator(accelerator);

	debug(`${accelerator} seems a valid shortcut sequence.`);

	let shortcutsOfWindowByState;
	let shortcutsOfWindow;
	if (windowsWithShortcuts.has(wc)) {
		debug('Window has others shortcuts registered.');
		shortcutsOfWindowByState = windowsWithShortcuts.get(wc);
		shortcutsOfWindow = shortcutsOfWindowByState[state];
	} else {
		debug('This is the first shortcut of the window.');
		shortcutsOfWindow = [];
		shortcutsOfWindowByState = { [state]: shortcutsOfWindow };
		windowsWithShortcuts.set(wc, shortcutsOfWindowByState);

		if (wc === ANY_WINDOW) {
			const keyHandler = _onBeforeInput(shortcutsOfWindow);
			const enableAppShortcuts = (e, win) => {
				const wc = win.webContents;
				wc.on('before-input-event', keyHandler);
				wc.once('closed', () =>
					wc.removeListener('before-input-event', keyHandler)
				);
			};

			// Enable shortcut on current windows
			const windows = BrowserWindow.getAllWindows();

			windows.forEach(win => enableAppShortcuts(null, win));

			// Enable shortcut on future windows
			app.on('browser-window-created', enableAppShortcuts);

			shortcutsOfWindowByState.removeListener = () => {
				const windows = BrowserWindow.getAllWindows();
				windows.forEach(win =>
					win.webContents.removeListener('before-input-event', keyHandler)
				);
				app.removeListener('browser-window-created', enableAppShortcuts);
			};
		} else {
			const keyHandler = _onBeforeInput(shortcutsOfWindow);
			wc.on('before-input-event', keyHandler);

			// Save a reference to allow remove of listener from elsewhere
			shortcutsOfWindowByState.removeListener = () =>
				wc.removeListener('before-input-event', keyHandler);
			wc.once('closed', shortcutsOfWindowByState.removeListener);
		}
	}

	debug('Adding shortcut to window set.');

	const eventStamp = toKeyEvent(accelerator);

	shortcutsOfWindow.push({
		eventStamp,
		callback,
		enabled: true
	});

	debug('Shortcut registered.');
}

/**
 * Unregisters the shortcut of `accelerator` registered on the BrowserWindow instance.
 * @param  {BrowserWindow} win - BrowserWindow instance to unregister.
 * This argument could be omitted, in this case the function unregister the shortcut
 * on all app windows. If you registered the shortcut on a particular window instance, it will do nothing.
 * @param  {String|Array<String>} accelerator - the shortcut to unregister
 */
function unregister(win, state, accelerator) {
	// NOTE(@averyyip) Unregister accelerator for win and state
	let wc;
	if (typeof accelerator === 'undefined') {
		wc = ANY_WINDOW;
		accelerator = win;
	} else {
		if (win.isDestroyed()) {
			debug('Early return because window is destroyed.');
			return;
		}

		wc = win.webContents;
	}

	if (Array.isArray(accelerator) === true) {
		accelerator.forEach(accelerator => {
			if (typeof accelerator === 'string') {
				unregister(win, state, accelerator);
			}
		});
		return;
	}

	debug(`Unregistering callback for ${accelerator} on window ${title(win)}`);

	_checkAccelerator(accelerator);

	debug(`${accelerator} seems a valid shortcut sequence.`);

	if (!windowsWithShortcuts.has(wc)) {
		debug('Early return because window has never had shortcuts registered.');
		return;
	}

	const shortcutsOfWindowByState = windowsWithShortcuts.get(wc);
	const shortcutsOfWindow = shortcutsOfWindowByState[state];

	const eventStamp = toKeyEvent(accelerator);
	const shortcutIdx = _findShortcut(eventStamp, shortcutsOfWindow);
	if (shortcutIdx === -1) {
		return;
	}

	shortcutsOfWindow.splice(shortcutIdx, 1);

	// If the window has no more shortcuts,
	// we remove it early from the WeakMap
	// and unregistering the event listener
	if (shortcutsOfWindow.length === 0) {
		delete shortcutsOfWindowByState[state];
	}

	if (Object.keys(shortcutsOfWindowByState).length === 0) {
		// Remove listener from window
		shortcutsOfWindowByState.removeListener();

		// Remove window from shortcuts catalog
		shortcutsOfWindowByState.delete(wc);
	}
}

/**
 * Returns `true` or `false` depending on whether the shortcut `accelerator`
 * is registered on `window`.
 * @param  {BrowserWindow} win - BrowserWindow instance to check. This argument
 * could be omitted, in this case the function returns whether the shortcut
 * `accelerator` is registered on all app windows. If you registered the
 * shortcut on a particular window instance, it return false.
 * @param  {String} accelerator - the shortcut to check
 * @return {Boolean} - if the shortcut `accelerator` is registered on `window`.
 */
function isRegistered(win, state, accelerator) {
	_checkAccelerator(accelerator);
	const wc = win.webContents;
	const shortcutsOfWindowByState = windowsWithShortcuts.get(wc);
	const shortcutsOfWindow = shortcutsOfWindowByState[state];
	const eventStamp = toKeyEvent(accelerator);

	return _findShortcut(eventStamp, shortcutsOfWindow) !== -1;
}

module.exports = {
	register,
	unregister,
	isRegistered,
	unregisterAll,
	enableAll,
	disableAll
};
