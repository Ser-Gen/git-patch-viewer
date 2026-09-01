/* File list: flat / tree, filter, status badges, viewed state, cursor. */
(function (root) {
	'use strict';

	var PV = root.PV = root.PV || {};
	var S = null;

	var state = {
		files: [],
		mode: 'tree',
		filter: '',
		collapsed: Object.create(null),
		cursor: -1,
		open: -1,
		viewed: Object.create(null),
		order: [],
		storageKey: null
	};

	var el = {};
	var onOpen = function () {};

	function init(elements, callbacks) {
		S = PV.strings;
		el = elements;
		onOpen = callbacks.onOpen;

		el.list.addEventListener('click', function (event) {
			var row = event.target.closest('.row');
			if (!row) return;

			if (row.classList.contains('dir')) {
				toggleDir(row.dataset.dir);
				return;
			}

			var index = parseInt(row.dataset.index, 10);

			if (event.target.classList.contains('vw')) {
				setViewed(index, event.target.checked);
				return;
			}

			state.cursor = index;
			open(index);
		});

		el.filter.addEventListener('input', function () {
			state.filter = el.filter.value.trim().toLowerCase();
			render();
		});

		el.filter.addEventListener('keydown', function (event) {
			if (event.key === 'Escape') {
				el.filter.value = '';
				state.filter = '';
				render();
				el.filter.blur();
			} else if (event.key === 'Enter' && state.order.length) {
				open(state.order[0]);
				el.filter.blur();
			}
		});

		el.flatBtn.addEventListener('click', function () { setMode('flat'); });
		el.treeBtn.addEventListener('click', function () { setMode('tree'); });
		el.markAll.addEventListener('click', function () { setAllViewed(true); });
		el.clearAll.addEventListener('click', function () { setAllViewed(false); });
	}

	function setFiles(files, storageKey) {
		state.files = files;
		state.storageKey = storageKey;
		state.collapsed = Object.create(null);
		state.cursor = files.length ? 0 : -1;
		state.open = -1;
		state.viewed = loadViewed();
		render();
	}

	/* ---------- viewed state ---------- */

	function loadViewed() {
		var map = Object.create(null);

		try {
			var raw = localStorage.getItem(state.storageKey);
			if (raw) {
				JSON.parse(raw).forEach(function (i) { map[i] = true; });
			}
		} catch (err) { /* private windows throw; carry on without persistence */ }

		return map;
	}

	function saveViewed() {
		try {
			localStorage.setItem(state.storageKey, JSON.stringify(Object.keys(state.viewed).map(Number)));
		} catch (err) { /* not fatal */ }
	}

	function setViewed(index, value) {
		if (value) state.viewed[index] = true;
		else delete state.viewed[index];
		saveViewed();
		syncRow(index);
		renderProgress();
	}

	function toggleViewed(index) {
		setViewed(index, !state.viewed[index]);
	}

	function setAllViewed(value) {
		state.viewed = Object.create(null);
		if (value) state.files.forEach(function (f) { state.viewed[f.index] = true; });
		saveViewed();
		render();
	}

	function syncRow(index) {
		var row = el.list.querySelector('.row[data-index="' + index + '"]');
		if (!row) return;
		row.classList.toggle('viewed', !!state.viewed[index]);
		var box = row.querySelector('.vw');
		if (box) box.checked = !!state.viewed[index];
	}

	/* ---------- rendering ---------- */

	function matches(file) {
		if (!state.filter) return true;
		return file.displayPath.toLowerCase().indexOf(state.filter) !== -1 ||
			(file.oldPath || '').toLowerCase().indexOf(state.filter) !== -1;
	}

	function visibleFiles() {
		return state.files.filter(matches);
	}

	function countsHtml(file) {
		if (file.combined) return '<span class="counts"><span class="tag">' + S.combinedTag + '</span></span>';
		if (file.isBinary) {
			var unviewable = file.binary && !file.binary.differOnly &&
				file.binary.blocks.length === 2 &&
				file.binary.blocks[0].kind === 'delta' && file.binary.blocks[1].kind === 'delta';
			if (file.binary && file.binary.differOnly) unviewable = true;
			return '<span class="counts"><span class="tag' + (unviewable ? ' none' : '') + '">' +
				(unviewable ? S.unviewableTag : S.binaryTag) + '</span></span>';
		}
		return '<span class="counts"><span class="a">+' + file.additions + '</span> <span class="d">−' + file.deletions + '</span></span>';
	}

	function rowHtml(file, label, depth) {
		var badge = S.statusBadge[file.status] || 'M';
		var classes = 'row file' +
			(state.viewed[file.index] ? ' viewed' : '') +
			(state.open === file.index ? ' open' : '') +
			(state.cursor === file.index ? ' cursor' : '');

		return '<div class="' + classes + '" data-index="' + file.index + '" title="' +
			PV.util.escapeHtml(file.displayPath) + '" style="padding-left:' + (6 + depth * 12) + 'px">' +
			'<input type="checkbox" class="vw"' + (state.viewed[file.index] ? ' checked' : '') + '>' +
			'<span class="badge b-' + file.status + '">' + badge + '</span>' +
			'<span class="name">' + label + '</span>' +
			countsHtml(file) + '</div>';
	}

	function splitPath(path) {
		var at = path.lastIndexOf('/');
		if (at === -1) return { dir: '', base: path };
		return { dir: path.slice(0, at + 1), base: path.slice(at + 1) };
	}

	function flatHtml(files) {
		var html = [];

		files.forEach(function (file) {
			var parts = splitPath(file.displayPath);
			var label = '<span class="dir">' + PV.util.escapeHtml(parts.dir) + '</span>' + PV.util.escapeHtml(parts.base);
			html.push(rowHtml(file, label, 0));
			state.order.push(file.index);
		});

		return html.join('');
	}

	function buildTree(files) {
		var root = { name: '', path: '', dirs: Object.create(null), order: [], files: [] };

		files.forEach(function (file) {
			var segments = file.displayPath.split('/');
			var node = root;

			for (var i = 0; i < segments.length - 1; i++) {
				var name = segments[i];
				if (!node.dirs[name]) {
					node.dirs[name] = { name: name, path: node.path + name + '/', dirs: Object.create(null), order: [], files: [] };
					node.order.push(name);
				}
				node = node.dirs[name];
			}

			node.files.push(file);
		});

		return root;
	}

	/* A chain of directories with a single child and no files of its own is
	   rendered as one row, so `assets/img/dest/brand/` costs one line. */
	function collapseChain(node) {
		var label = node.name;

		while (node.files.length === 0 && node.order.length === 1) {
			var only = node.dirs[node.order[0]];
			label += '/' + only.name;
			node = only;
		}

		return { node: node, label: label };
	}

	function treeHtml(node, depth, html) {
		node.order.forEach(function (name) {
			var merged = collapseChain(node.dirs[name]);
			var dir = merged.node;
			var isCollapsed = !!state.collapsed[dir.path];
			var total = countFiles(dir);

			html.push('<div class="row dir' + (isCollapsed ? ' collapsed' : '') + '" data-dir="' +
				PV.util.escapeHtml(dir.path) + '" style="padding-left:' + (6 + depth * 12) + 'px">' +
				'<span class="caret">▾</span>' +
				'<span class="name">' + PV.util.escapeHtml(merged.label) + '/</span>' +
				'<span class="counts">' + total + '</span></div>');

			if (!isCollapsed) treeHtml(dir, depth + 1, html);
		});

		node.files.forEach(function (file) {
			html.push(rowHtml(file, PV.util.escapeHtml(splitPath(file.displayPath).base), depth));
			state.order.push(file.index);
		});

		return html;
	}

	function countFiles(node) {
		var total = node.files.length;
		node.order.forEach(function (name) { total += countFiles(node.dirs[name]); });
		return total;
	}

	function render() {
		var files = visibleFiles();
		state.order = [];

		el.flatBtn.classList.toggle('on', state.mode === 'flat');
		el.treeBtn.classList.toggle('on', state.mode === 'tree');

		if (!files.length) {
			el.list.innerHTML = '<div class="empty-hint">' + S.noMatches + '</div>';
			renderProgress();
			return;
		}

		el.list.innerHTML = state.mode === 'flat' ? flatHtml(files) : treeHtml(buildTree(files), 0, []).join('');

		if (state.order.indexOf(state.cursor) === -1) state.cursor = state.order[0];
		renderProgress();
		scrollCursorIntoView();
	}

	function renderProgress() {
		var done = Object.keys(state.viewed).length;
		el.progress.textContent = S.viewedProgress(done, state.files.length);
	}

	function toggleDir(path) {
		if (state.collapsed[path]) delete state.collapsed[path];
		else state.collapsed[path] = true;
		render();
	}

	function setMode(mode) {
		state.mode = mode;
		render();
	}

	function toggleMode() {
		setMode(state.mode === 'tree' ? 'flat' : 'tree');
	}

	function scrollCursorIntoView() {
		var row = el.list.querySelector('.row.cursor');
		if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
	}

	function highlight() {
		Array.prototype.forEach.call(el.list.querySelectorAll('.row.file'), function (row) {
			var index = parseInt(row.dataset.index, 10);
			row.classList.toggle('cursor', index === state.cursor);
			row.classList.toggle('open', index === state.open);
		});
		scrollCursorIntoView();
	}

	function moveCursor(delta) {
		if (!state.order.length) return;
		var at = state.order.indexOf(state.cursor);
		var next = at === -1 ? 0 : Math.min(state.order.length - 1, Math.max(0, at + delta));
		state.cursor = state.order[next];
		highlight();
	}

	function open(index) {
		if (index == null || index < 0) return;
		state.open = index;
		state.cursor = index;
		highlight();
		onOpen(state.files[index]);
	}

	function openCursor() {
		open(state.cursor);
	}

	PV.sidebar = {
		init: init,
		setFiles: setFiles,
		render: render,
		open: open,
		openCursor: openCursor,
		moveCursor: moveCursor,
		toggleMode: toggleMode,
		toggleViewed: toggleViewed,
		focusFilter: function () { el.filter.focus(); el.filter.select(); },
		clearFilter: function () { el.filter.value = ''; state.filter = ''; render(); },
		state: state
	};
}(typeof window !== 'undefined' ? window : globalThis));
