const usernamePage = document.querySelector('#username-page');
const resultsPage = document.querySelector('#results-page');

const usernameForm = usernamePage.querySelector('#username-form');
const username = usernamePage.querySelector('#username');

class Game {
	constructor(rawGame, username) {
		this.#skip(rawGame);
		this.rawGame = rawGame;

		const white = rawGame.white;
		const black = rawGame.black;
		if (white.username === username) {
			this.colorPlayed = 'white';
			this.you = white;
			this.oponent = black;
			this.elo = Number(rawGame.blackelo);
		} else if (black.username === username) {
			this.colorPlayed = 'black';
			this.you = black;
			this.oponent = white;
			this.elo = Number(rawGame.blackelo);
		} else {
			throw new Error('Player is not playing game');
		}

		this.timeClass = rawGame.time_class;
		this.timeControl = rawGame.time_control;
		this.#parseTimeControl();
		let seconds = ':' + ('0' + (this.startingTime % 60)).slice(-2);
		if (seconds === ':00') seconds = '';
		const baseTime = Math.floor(this.startingTime / 60) + seconds;
		this.timeControl = `${baseTime} | ${this.increment}`;

		this.rawPGN = rawGame.pgn;
		const moves = this.#parsePGN();

		this.you.moves = [];
		this.oponent.moves = [];
		let previousTimeYou = this.startingTime;
		let previousTimeOponent = this.startingTime;
		for (const move of moves) {
			const [, moveNumber, periodsForColor, hours, minutes, seconds] = move;
			const color = periodsForColor === '.' ? 'white' : 'black';
			const timeLeft = this.#calcTime(hours, minutes, seconds);
			if (color === this.colorPlayed) {
				const timeDiff = round(
					previousTimeYou - (timeLeft - this.increment),
					2
				);
				const oponentTimeSpent = this.oponent.moves.at(-1)?.timeDiff ?? null;
				if (timeDiff < 0) continue;
				this.you.moves.push({
					moveNumber,
					timeDiff,
					timeLeft,
					oponentTimeSpent,
				});
				previousTimeYou = timeLeft;
			} else {
				const timeDiff = round(
					previousTimeOponent - (timeLeft - this.increment),
					2
				);
				const oponentTimeSpent = this.you.moves.at(-1)?.timeDiff ?? null;
				if (timeDiff < 0) continue;
				this.oponent.moves.push({
					moveNumber,
					timeDiff,
					timeLeft,
					oponentTimeSpent,
				});
				previousTimeOponent = timeLeft;
			}
		}
	}

	#skip(rawGame) {
		let skip = false;
		if (rawGame.time_class === 'daily') {
			skip = true;
		} else if (rawGame.rules != 'chess') {
			skip = true;
		}
		if (skip) {
			throw new Error('Skip');
		}
	}

	#parseTimeControl() {
		// get the base timecontrol and increment
		const re = /^(\d+)(?:\+(\d+))?$/;
		const [, base, increment] = this.timeControl.match(re);
		this.startingTime = base;
		this.increment = increment ?? 0;
	}

	#parsePGN() {
		// gets all the game meta data
		const splitLines = /\[([a-zA-Z]+) (".*?")\]\n/g;
		const lines = Array.from(this.rawPGN.matchAll(splitLines));
		for (const line of lines) {
			this[line[1].toLowerCase()] = line[2].substring(1, line[2].length - 1);
		}

		//get termination type
		const terminationType = /^([^ ]*) ([^ ]*) [^ ]* (.*)$/;
		const gameResult = this.termination.match(terminationType);
		this.termination = gameResult[3].replace(/-/g, ' ');

		if (gameResult[2] === 'drawn') {
			this.result = 'Draw';
		} else if (this.you.username === gameResult[1]) {
			this.result = gameResult[2] === 'won' ? 'Won' : 'Lost';
		} else if (this.you.username !== gameResult[1]) {
			this.result = gameResult[2] === 'won' ? 'Lost' : 'Won';
		} else {
			throw new Error('Skip');
		}

		// splits the pgn into moves
		const findMoves =
			/(\d+)(\.{1,3}) [^ ]+ \{\[%clk (\d+):(\d+):(\d+(?:\.\d)?)\]\}/g;
		const pgn = Array.from(this.rawPGN.matchAll(findMoves));
		return pgn;
	}

	#calcTime(hours, minutes, seconds) {
		// return time in seconds
		return round(
			(Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds),
			2
		);
	}

	meetsConditions(conditions) {
		for (let condition of conditions) {
			if (condition(this)) {
				return false;
			}
		}
		return true;
	}
}

class AllGames {
	constructor(filterId) {
		this.games = new Map();
		this.filterId = filterId;
	}

	results() {
		const that = this;
		const progressBar = document.createElement('div');
		progressBar.classList.add('waiting');
		const bar = document.createElement('div');
		bar.classList.add('waiting-value');
		progressBar.appendChild(bar);
		const filter = resultsPage.querySelector(`#${this.filterId}`);
		return (event) => {
			if (event) event.preventDefault();
			filter.appendChild(progressBar);
			setTimeout(() => {
				// I don't know why, but the progress bar does not work without the setTimeout
				const [allGames, allMoves] = that.filter.allMoves();
				new GameCalculators(allGames).calcAll();
				new MoveCalculators(allMoves).calcAll();
				filter.removeChild(progressBar);
			})
		};
	}

	addPlayer(username, games) {
		this.games.set(username, games);

		this.filter = new Filter(this.filterId, this.games);
		this.results()();
		const filter = resultsPage.querySelector(`#${this.filterId}`);
		filter.addEventListener('submit', this.results());
	}
}

class GameCalculators {
	constructor(allGames) {
		this.games = allGames;
	}

	calcAll() {
		const allCalculators = ['totalGames', 'averageMoves', 'medianMoves'];
		const table = new Table([
			'Player',
			'Total Games',
			'Average Moves',
			'Median Moves',
		]);
		resultsPage.querySelector('#game-data').replaceChildren(table.container);

		for (const [player, games] of this.games) {
			const row = [player];
			for (const calculator of allCalculators) {
				if (games.length === 0) {
					if (calculator === 'totalGames') {
						row.push(0);
					} else {
						row.push('N/A');
					}
					continue;
				}
				row.push(this[calculator](games));
			}
			table.addRow(row);
		}
	}

	totalGames(games) {
		return games.length;
	}

	averageMoves(games) {
		const averageMoves = round(
			games.reduce((acc, game) => {
				return acc + game.you.moves.length;
			}, 0) / games.length,
			1
		);
		return averageMoves;
	}

	medianMoves(games) {
		const medianMoves = round(
			median(games, (a, b) => {
				return a.you.moves.length - b.you.moves.length;
			}).you.moves.length
		);
		return medianMoves;
	}
}
class MoveCalculators {
	constructor(allMoves) {
		this.moves = allMoves;
	}

	calcAll() {
		const singleValueCalculator = [
			'totalMoves',
			'averageTimePerMove',
			'medianTimePerMove',
			'premovePercent',
		];
		const graphs = [
			'moveTime',
			'timeVsMoveNumber',
			'timeVsTime',
			'timeVsOponentTimeSpent',
		];
		const table = new Table([
			'Player',
			'Total Moves',
			'Average Time Per Move',
			'Median Time Per Move',
			'Premove Percent',
		]);
		resultsPage.querySelector('#move-data').replaceChildren(table.container);

		for (const [player, moves] of this.moves) {
			const row = [player];
			for (const calculator of singleValueCalculator) {
				if (moves.length === 0) {
					if (calculator === 'totalMoves') {
						row.push(0);
					} else {
						row.push('N/A');
					}
					continue;
				}
				row.push(this[calculator](moves));
			}
			table.addRow(row);
		}

		for (const graph of graphs) {
			this[graph]();
		}
	}

	totalMoves(moves) {
		return moves.length;
	}

	averageTimePerMove(moves) {
		const averageTime = round(
			moves.reduce((acc, move) => acc + move.timeDiff, 0) / moves.length,
			1
		);
		return averageTime;
	}

	medianTimePerMove(moves) {
		const medianTimePerMove = round(
			median(moves, (a, b) => a.timeDiff - b.timeDiff).timeDiff,
			1
		);
		return medianTimePerMove;
	}

	premovePercent(moves) {
		const premovePercent =
			(moves.reduce((acc, move) => {
				if (move.timeDiff <= 0.1) {
					return acc + 1;
				}
				return acc;
			}, 0) /
				moves.length) *
			100;
		return round(premovePercent) + '%';
	}

	moveTime() {
		const lines = [];
		for (const player of this.moves) {
			const moves = player[1].map((move) => move.timeDiff);
			lines.push({ data: moves, name: player[0] });
		}
		const container = document.createElement('div');
		container.id = 'time-per-move';
		resultsPage.querySelector('#move-data').appendChild(container);
		new BoxPlot('time-per-move', lines);
	}

	timeVsMoveNumber() {
		const lines = [];
		for (const player of this.moves) {
			const averages = {};
			for (let move of player[1]) {
				if (!averages[move.moveNumber]) {
					averages[move.moveNumber] = { total: 0, count: 0 };
				}
				averages[move.moveNumber].total += +move.timeDiff;
				averages[move.moveNumber].count += 1;
			}
			const x = [];
			const y = [];
			for (let [moveNumber, average] of Object.entries(averages)) {
				x.push(+moveNumber);
				y.push(average.total / average.count);
			}
			lines.push({ x: x, y: y, name: player[0] });
		}
		const container = document.createElement('div');
		container.id = 'time-vs-move-number';
		resultsPage.querySelector('#move-data').appendChild(container);
		new LineGraph('time-vs-move-number', lines);
	}

	timeVsTime() {
		const lines = [];
		for (const player of this.moves) {
			const averages = {};
			for (let move of player[1]) {
				const timeLeft = Math.floor(move.timeLeft);
				if (!averages[timeLeft]) {
					averages[timeLeft] = { total: 0, count: 0 };
				}
				averages[timeLeft].total += +move.timeDiff;
				averages[timeLeft].count += 1;
			}
			const x = [];
			const y = [];
			for (let [moveNumber, average] of Object.entries(averages)) {
				x.push(+moveNumber);
				y.push(average.total / average.count);
			}
			lines.push({ x: x, y: y, name: player[0] });
		}
		const container = document.createElement('div');
		container.id = 'time-vs-time';
		resultsPage.querySelector('#move-data').appendChild(container);
		new LineGraph('time-vs-time', lines);
	}

	timeVsOponentTimeSpent() {
		const lines = [];
		for (const player of this.moves) {
			const averages = {};
			for (const move of player[1]) {
				const oponentTimeSpent = Math.floor(move.oponentTimeSpent);
				if (!oponentTimeSpent) {
					continue;
				}
				if (!averages[oponentTimeSpent]) {
					averages[oponentTimeSpent] = { total: 0, count: 0 };
				}
				averages[oponentTimeSpent].total += +move.timeDiff;
				averages[oponentTimeSpent].count += 1;
			}
			const x = [];
			const y = [];
			for (let [oponentTimeSpent, average] of Object.entries(averages)) {
				x.push(+oponentTimeSpent);
				y.push(average.total / average.count);
			}
			lines.push({ x: x, y: y, name: player[0] });
		}
		const container = document.createElement('div');
		container.id = 'time-vs-oponent-time-spent';
		resultsPage.querySelector('#move-data').appendChild(container);
		new LineGraph('time-vs-oponent-time-spent', lines);
	}
}

class Filter {
	constructor(containerId, games) {
		this.container = document.querySelector(`#${containerId}`);
		this.container.innerHTML = '';
		this.games = games;
		this.#addMultiSelect(
			'playerMultiSelect',
			'Players:',
			Array.from(this.games.keys())
		);
		this.#addToggle('oponentToggle', 'Show Oponents', 'oponent-checkbox');
		this.#addMultiSelect('colorMultiSelect', 'Color:', ['White', 'Black']);
		this.#addSubOption(
			'terminationSubOption',
			'Result:',
			this.#allTerminations
		);
		this.#addSubOption(
			'timeControlSubOption',
			'Time Control:',
			this.#allTimeControls
		);
		this.#addSlider('ratingSlider', 'Rating', ...this.#ratingRange);
		this.#addSlider(
			'moveNumberSlider',
			'Move Number',
			...this.#moveNumberRange
		);
		this.#addSlider(
			'timeLeftSlider',
			'Time Left (Seconds)',
			...this.#timeLeftRange
		);
		const button = document.createElement('button');
		button.innerText = 'filter';
		this.container.appendChild(button);
	}

	allMoves() {
		const allGames = new Map();
		const allMoves = new Map();

		for (const player of this.playerMultiSelect.values) {
			const games = [];
			const moves = [];
			const oponentGames = [];
			const oponentMoves = [];
			const getMoves = (game) => {
				if (this.gameConditions(game)) {
					games.push(game);
					for (const move of game.you.moves) {
						if (this.moveConditions(move)) {
							moves.push(move);
						}
					}
					if (this.oponentToggle.values) {
						oponentGames.push(game);
						for (const move of game.oponent.moves) {
							if (this.moveConditions(move)) {
								oponentMoves.push(move);
							}
						}
					}
				}
			};
			this.#loopGames(getMoves, [player]);
			allGames.set(player, games);
			allMoves.set(player, moves);
			if (this.oponentToggle.values) {
				allGames.set(`${player}'s oponents`, oponentGames);
				allMoves.set(`${player}'s oponents`, oponentMoves);
			}
		}

		return [allGames, allMoves];
	}

	gameConditions(game) {
		const conditions = [
			'filterTermination',
			'filterTimeControl',
			'filterRating',
			'filterColor',
		];

		for (const condition of conditions) {
			if (!this[condition](game)) return false;
		}
		return true;
	}

	moveConditions(move) {
		const conditions = ['filterMoveNumber', 'filterTimeLeft'];

		for (const condition of conditions) {
			if (!this[condition](move)) return false;
		}
		return true;
	}

	filterColor(game) {
		return this.colorMultiSelect.values
			.map((color) => {
				return color.toLowerCase();
			})
			.includes(game.colorPlayed);
	}

	filterTermination(game) {
		const resultMap = {
			resigned: 'Loss',
			win: 'Win',
			checkmated: 'Loss',
			insufficient: 'Draw',
			stalemate: 'Draw',
			timeout: 'Loss',
			abandoned: 'Loss',
			agreed: 'Draw',
			repetition: 'Draw',
			timevsinsufficient: 'Draw',
			'50move': 'Draw',
		};
		const filterValues = this.terminationSubOption.values;
		const validResult = filterValues[0].includes(resultMap[game.you.result]);
		const validTermination = filterValues[1].includes(game.termination);

		return validResult && validTermination;
	}

	filterTimeControl(game) {
		const filterValues = this.timeControlSubOption.values;
		const validTimeClass = filterValues[0].includes(game.timeClass);
		const validTimeControl = filterValues[1].includes(game.timeControl);
		return validTimeClass && validTimeControl;
	}

	filterRating(game) {
		const range = this.ratingSlider.values;
		return Filter.inRange(range[0], range[1], game.you.rating);
	}

	filterMoveNumber(move) {
		const range = this.moveNumberSlider.values;
		return Filter.inRange(range[0], range[1], Number(move.moveNumber));
	}

	filterTimeLeft(move) {
		const range = this.timeLeftSlider.values;
		return Filter.inRange(range[0], range[1], Number(move.timeLeft));
	}

	#addToggle(name, title, checkboxId) {
		this[name] = new Toggle(title, checkboxId);
		this.container.appendChild(this[name].container);
	}

	#addMultiSelect(name, title, options) {
		this[name] = new MultiSelect(title, options);
		this.container.appendChild(this[name].container);
	}

	#addSubOption(name, title, options) {
		this[name] = new SubSelect(title, options);
		this.container.appendChild(this[name].container);
	}

	#addSlider(name, title, min, max) {
		this[name] = new RangeSlider(title, min, max);
		this.container.appendChild(this[name].container);
	}

	#loopGames(func, players = false) {
		if (!players) {
			players = Array.from(this.games.keys());
		}
		for (const [player, games] of this.games) {
			if (!players.includes(player)) continue;
			for (const game of games) {
				func(game);
			}
		}
	}

	static inRange(min, max, value) {
		return min <= value && max >= value;
	}

	static capitalizeFirstLetters(...strings) {
		const formatted = [];
		for (const string of strings) {
			const words = string.split(' ');
			let formattedWords = [];
			for (const word of words) {
				formattedWords.push(word.charAt(0).toUpperCase() + word.slice(1));
			}
			formatted.push(formattedWords.join(' '));
		}
		return formatted;
	}

	get #allTerminations() {
		const allTerminations = new Map();
		allTerminations.set('Win', []);
		allTerminations.set('Draw', []);
		allTerminations.set('Loss', []);
		const resultMap = {
			resigned: 'Loss',
			win: 'Win',
			checkmated: 'Loss',
			insufficient: 'Draw',
			stalemate: 'Draw',
			timeout: 'Loss',
			abandoned: 'Loss',
			agreed: 'Draw',
			repetition: 'Draw',
			timevsinsufficient: 'Draw',
			'50move': 'Draw',
		};
		const allResults = new Set();
		const getTermination = (game) => {
			allResults.add(game.you.result);
			const result = resultMap[game.you.result];
			if (!allTerminations.get(result).includes(game.termination)) {
				allTerminations.set(result, [
					...allTerminations.get(result),
					game.termination,
				]);
			}
		};

		this.#loopGames(getTermination);

		const formattedTerminations = new Map();
		for (const [result, terminations] of allTerminations) {
			formattedTerminations.set(
				result,
				Filter.capitalizeFirstLetters(...terminations)
			);
		}

		return formattedTerminations;
	}

	get #allTimeControls() {
		const timeClasses = {};
		const getTimeControl = (game) => {
			if (timeClasses[game.timeClass] === undefined) {
				timeClasses[game.timeClass] = {};
			}
			const timeClass = timeClasses[game.timeClass];
			if (timeClass[game.timeControl] === undefined) {
				timeClass[game.timeControl] = 0;
			}
			timeClass[game.timeControl] += 1;
		};

		this.#loopGames(getTimeControl);

		for (const [timeClass, timeControls] of Object.entries(timeClasses)) {
			let sortable = Object.entries(timeControls);

			sortable.sort(function (a, b) {
				return b[1] - a[1];
			});

			sortable = sortable.reduce((acc, timeControl) => {
				return [...acc, timeControl[0]];
			}, []);

			timeClasses[timeClass] = sortable;
		}

		return Object.entries(timeClasses);
	}

	get #ratingRange() {
		let min = Infinity;
		let max = 0;
		const getRange = (game) => {
			if (game.you.rating < min) {
				min = game.you.rating;
			}
			if (game.you.rating > max) {
				max = game.you.rating;
			}
		};
		this.#loopGames(getRange);

		return [min, max];
	}

	get #moveNumberRange() {
		let min = Infinity;
		let max = 0;
		const getRange = (game) => {
			for (const move of game.you.moves) {
				const moveNumber = Number(move.moveNumber);
				if (moveNumber < min) {
					min = moveNumber;
				}
				if (moveNumber > max) {
					max = moveNumber;
				}
			}
		};
		this.#loopGames(getRange);

		return [min, max];
	}

	get #timeLeftRange() {
		let min = Infinity;
		let max = 0;
		const getRange = (game) => {
			for (const move of game.you.moves) {
				const timeLeft = move.timeLeft;
				if (timeLeft < min) {
					min = timeLeft;
				}
				if (timeLeft > max) {
					max = timeLeft;
				}
			}
		};
		this.#loopGames(getRange);

		return [min, Math.ceil(max)];
	}
}

function round(number, digits = 0) {
	return Math.round((number + Number.EPSILON) * 10 ** digits) / 10 ** digits;
}

function median(list, sort) {
	if (list.length === 0) return NaN;

	list.sort(sort);

	const half = Math.floor(list.length / 2);

	return list[half];
}

class Table {
	constructor(columns) {
		this.container = document.createElement('table');
		this.columns = columns;
		const headers = document.createElement('tr');
		for (const value of columns) {
			const cell = document.createElement('th');
			cell.innerText = value;
			headers.appendChild(cell);
		}
		this.container.appendChild(headers);
		this.rows = [];
	}

	addRow(values) {
		const newRow = document.createElement('tr');
		for (const value of values) {
			const cell = document.createElement('td');
			cell.innerText = value;
			newRow.appendChild(cell);
		}
		this.rows.push(newRow);
		this.container.appendChild(newRow);
	}
}

class BoxPlot {
	constructor(id, players) {
		const data = [];
		for (const player of players) {
			const trace = {
				x: player.data,
				boxpoints: false,
				type: 'box',
				name: player.name,
			};

			data.push(trace);
		}

		const layout = {
			title: 'Horizontal Box Plot',
		};

		Plotly.newPlot(id, data, layout);
	}
}

class LineGraph {
	constructor(id, players) {
		const data = [];
		for (const player of players) {
			const trace = {
				x: player.x,
				y: player.y,
				type: 'scatter',
				name: player.name,
			};

			data.push(trace);
		}
		Plotly.newPlot(id, data, {
			displayModeBar: false,
			staticPlot: true,
		});
	}
}

class Toggle {
	constructor(title, toggleId) {
		this.container = document.createElement('div');
		this.label = document.createElement('label');
		this.label.innerText = title;
		this.label.setAttribute('for', toggleId);
		this.checkbox = document.createElement('input');
		this.checkbox.id = toggleId;
		this.checkbox.setAttribute('type', 'checkbox');
		this.container.appendChild(this.label);
		this.container.appendChild(this.checkbox);
	}

	get values() {
		return this.checkbox.checked;
	}
}

class MultiSelect {
	constructor(title, options) {
		this.container = document.createElement('div');
		const header = document.createElement('h3');
		header.classList.add('multi-select-header');
		header.innerText = title;
		this.container.innerText = title;
		const optionContainer = document.createElement('div');
		this.selectInput = document.createElement('select');
		this.selectInput.multiple = true;
		this.selectInput.classList.add('hide');
		for (const option of options) {
			const styledOption = document.createElement('button');
			styledOption.classList.add('multiselect-option', 'selected');
			styledOption.innerText = option;
			const hiddenOption = document.createElement('option');
			hiddenOption.innerText = option;
			hiddenOption.value = option;
			hiddenOption.toggleAttribute('selected', true);
			styledOption.addEventListener(
				'click',
				this.#select(styledOption, hiddenOption)
			);
			optionContainer.appendChild(styledOption);
			this.selectInput.appendChild(hiddenOption);
		}
		this.container.appendChild(optionContainer);
		this.container.appendChild(this.selectInput);
	}

	#select(prettyOption, formOption) {
		return (event) => {
			event.preventDefault();
			prettyOption.classList.toggle('selected');
			formOption.toggleAttribute('selected');
		};
	}

	get values() {
		const values = [];
		for (let option of this.selectInput.children) {
			if (option.selected) {
				values.push(option.value);
			}
		}
		return values;
	}
}

class SubSelect {
	constructor(title, options) {
		this.container = document.createElement('div');
		const header = document.createElement('h3');
		header.classList.add('sub-select-header');
		header.innerText = title;
		this.container.appendChild(header);
		this.broadSelections = [];
		this.selectInput = document.createElement('select');
		this.selectInput.multiple = true;
		this.selectInput.classList.add('hide');
		this.container.appendChild(this.selectInput);
		for (const [broadOption, subOptions] of options) {
			const optionContainer = document.createElement('div');
			const broadOptionContainer = document.createElement('div');
			const broadOptionHtml = document.createElement('button');
			broadOptionContainer.appendChild(broadOptionHtml);
			broadOptionContainer.appendChild(optionContainer);
			broadOptionHtml.innerText = broadOption;
			broadOptionHtml.classList.add('broadOption', 'selected');
			this.broadSelections.push(broadOption);
			const newOptions = [];
			for (const value of subOptions) {
				const subOptionHtml = document.createElement('button');
				optionContainer.appendChild(subOptionHtml);
				subOptionHtml.innerText = value;
				subOptionHtml.classList.add('selected');
				const subOptionHidden = document.createElement('option');
				subOptionHidden.innerText = value;
				subOptionHidden.value = value;
				subOptionHidden.toggleAttribute('selected', true);
				subOptionHtml.addEventListener(
					'click',
					this.selectSubOption(
						subOptionHtml,
						subOptionHidden,
						broadOptionHtml,
						broadOption
					)
				);
				newOptions.push([subOptionHtml, subOptionHidden]);
				this.selectInput.appendChild(subOptionHidden);
			}
			broadOptionHtml.addEventListener(
				'click',
				this.broadSelectOption(broadOptionHtml, newOptions, broadOption)
			);
			this.container.appendChild(broadOptionContainer);
		}
	}

	broadSelectOption(option, subOptions, value) {
		return (event) => {
			event.preventDefault();
			option.classList.toggle('selected');
			const isSelected = option.classList.contains('selected');
			for (const [styledOption, hiddenOption] of subOptions) {
				if (isSelected) {
					styledOption.classList.add('selected');
					this.broadSelections.push(value);
				} else {
					styledOption.classList.remove('selected');
					this.broadSelections = this.broadSelections.filter((selection) => {
						return selection !== value;
					});
				}
				hiddenOption.toggleAttribute('selected', isSelected);
			}
		};
	}

	selectSubOption(option, hiddenOption, parentOption, parentValue) {
		return (event) => {
			event.preventDefault();
			option.classList.toggle('selected');
			hiddenOption.toggleAttribute('selected');
			if (option.classList.contains('selected')) {
				parentOption.classList.add('selected');
				this.broadSelections.push(parentValue);
			}
		};
	}

	get values() {
		const values = [];
		for (let option of this.selectInput.children) {
			if (option.selected) {
				values.push(option.value.toLowerCase());
			}
		}

		return [this.broadSelections, values];
	}
}

class RangeSlider {
	constructor(title, start, stop) {
		this.container = document.createElement('div');
		this.container.classList.add('range-slider');
		const header = document.createElement('h3');
		header.classList.add('range-slider-header');
		header.innerText = title;
		this.container.appendChild(header);
		const range = document.createElement('div');
		this.slider = noUiSlider.create(range, {
			start: [Math.floor(start), Math.ceil(stop)],
			connect: true,
			range: {
				min: start,
				max: stop,
			},
			step: 1,
			tooltips: true,
			format: {
				from: function (value) {
					return parseInt(value);
				},
				to: function (value) {
					return parseInt(value);
				},
			},
		});
		this.container.appendChild(range);
	}

	get values() {
		return this.slider.get();
	}
}

const allGames = new AllGames('filter-form');

const urls = {
	archiveList: (username) =>
		`https://api.chess.com/pub/player/${username}/games/archives`,
};

async function chesscomGames() {
	let archives;
	try {
		archives = await axios.get(urls.archiveList(username.value));
	} catch (error) {
		console.error(error);
	}
	const progressBar = document.querySelector('progress');
	progressBar.setAttribute('max', archives.data.archives.length);
	let value = 0;
	progressBar.setAttribute('value', value);
	progressBar.removeAttribute('aria-hidden');
	const allGames = [];
	for (const month of archives.data.archives) {
		try {
			const games = await axios.get(month);
			allGames.push(games.data.games);
			value += 1;
			progressBar.setAttribute('value', value);
		} catch (error) {
			console.error(error);
		}
	}
	progressBar.toggleAttribute('aria-hidden');

	return allGames.flat(1);
}

usernameForm.addEventListener('submit', async (event) => {
	event.preventDefault();

	const rawGames = await chesscomGames();
	allGames.addPlayer(
		username.value,
		rawGames.reduce((acc, game) => {
			try {
				return [...acc, new Game(game, username.value)];
			} catch (error) {
				if (error.message === 'Skip') {
					return acc;
				}
				throw new Error(error.message);
			}
		}, [])
	);

	console.log(allGames.games);
});
