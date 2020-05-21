let Matcher = module.exports = {}; // Skeleton
let Trakt = {}; // the main API for trakt (npm: 'trakt.tv')
const path = require('path');
const parseVideo = require('video-name-parser');
const keywordFilter = require('./keywords_filter.json');
let match = false; // global used to reduce nb of calls to trakt

// Initialize the module
Matcher.init = (trakt) => {
    Trakt = trakt;
};

const injectPath = (file, loc) => {
    if (!file) {
        file = path.basename(loc);
    }

    return file; // maybe check dir tree some day
};

const injectTorrent = (file, torrent) => {
    let parsed = null;
    let clean = torrent.match(/.*?(complete.series|complete.season|s\d+|season|\[|hdtv|\W\s)/i);

    if (clean === null || clean[0] === '') {
        parsed = torrent;
    } else {
        parsed = clean[0].replace(clean[1], '').replace(/\s+/, '');
    }

    let regx = new RegExp(parsed.split(/\W/)[0], 'ig');
    let duplicate = file.match(regx);

    if (duplicate === null && parsed.toLowerCase() !== 'from') {
        file = parsed + ' ' + file;
    }

    return file;
};

const parseInput = (obj) => {
    if (!obj || (obj && (!obj.path && !obj.filename))) {
        throw 'Missing arguments, were filename/path passed?';
    }

    if (obj.filename) {
        if (!obj.path && !obj.torrent) {
            return obj.filename;
        }
        if (obj.path) {
            if (obj.torrent) {
                return injectTorrent(obj.filename, obj.torrent);
            } else {
                return injectPath(obj.filename, obj.path);
            }
        }
        if (obj.torrent) {
            return injectTorrent(obj.filename, obj.torrent);
        }
    } else if (obj.path) {
        if (obj.torrent) {
            return injectTorrent(injectPath(null, obj.path), obj.torrent);
        } else {
            return injectPath(null, obj.path);
        }
    }
};

const detectQuality = (title) => {
    if (title.match(/480[pix]/i)) {
        return 'SD';
    }
    if (title.match(/720[pix]/i) && !title.match(/dvdrip|dvd\Wrip/i)) {
        return 'HD';
    }
    if (title.match(/1080[pix]/i)) {
        return 'FHD';
    }

    // not found, trying harder
    if (title.match(/dsr|dvdrip|dvd\Wrip|hdrip|webrip|dvdsrc|b[rd]rip|web-dl|hdts|hd\Wts|\Wts\W|telesync|\Wcam\W/i)) {
        return 'SD';
    }
    if (title.match(/hdtv/i) && !title.match(/720[pix]/i)) {
        return 'SD';
    }
    return false;
};

const removeKeywords = (str) => {
    let words = str.split(' ');
    for (let i = 0, leni = words.length; i < leni; i++) {
        for (let j = 0, lenj = keywordFilter.length; j < lenj; j++) {
            if (words[i] === keywordFilter[j]) {
                words[i] = '';
            }
        }
    }
    return words.join(' ').trim();
};

const formatTitle = (title) => {
    let formatted = parseVideo(title);
    if (!formatted.name) {
        formatted.name = title.replace(/[^a-z0-9]/g, '-').replace(/\-+/g, '-').replace(/\-$/, '');
    }

    formatted.name = removeKeywords(formatted.name);

    let tmpYear = formatted.year || formatted.aired;
    if (tmpYear) {
        if (title.match(new RegExp(tmpYear+'\\W(year|light|meter|feet|miles)', 'i')) !== null) {
            tmpYear = undefined;
        }
    }

    Trakt._debug('Parsed: ' + formatted.name);	
    return {
        title: formatted.name
            .replace(/[^a-z0-9]/g, '-')
            .replace(/\-+/g, '-')
            .replace(/\-$/, ''),
        season: formatted.season,
        episode: formatted.episode,
        year: tmpYear
    };
};

const checkApostrophy = (obj) => {
    obj.title = [obj.title];

    let matcher = obj.title[0].match(/\w{2}s-/gi);
    if (matcher !== null) {
        for (let i = 0, len = matcher.length; i < len; i++) {
            obj.title.push(obj.title[0].replace(matcher[i], matcher[i].substring(0, 2) + '-s-'));
        }
    }

    return obj;
};

const checkYear = (obj) => {
    if (obj.season && obj.episode) {
        let maybe = '' + obj.season + obj.episode[0];
        if (maybe.match(/19\d{2}|20\d{2}/) !== null && obj.title[0].match(/19\d{2}|20\d{2}/) === null) {
            obj.title.push(obj.title[0] + '-' + maybe);
        }
    }
    return obj;
};

const checkTraktSearch = (trakt, filename) => {
    // stats
    let success = 0,
        fail = 0;

    // words in title
    let words = trakt
        .match(/[\w+\s+]+/ig)[0]
        .split(' ');

    // verification
    for (let i = 0, len = words.length; i < len; i++) {
        // check only words longer than 4 chars
        if (words[i].length >= 3) {
            let regxp = new RegExp(words[i].slice(0, 3), 'ig');
            filename.replace(/\W/ig, '').match(regxp) === null ?
                fail++ :
                success++;
        }
    }

    // avoid /0 errors
    if (success + fail === 0) fail = 1;

    // calc rate
    let successRate = success / (success + fail);
    Trakt._debug('Trakt search matching rate: ' + (successRate * 100) + '%');

    return successRate >= .6;
};

const searchMovie = (title, year) => {
    return new Promise((resolve, reject) => {
        // find a matching movie
        let searchObj = {
            query: title.replace(/-s-/g, 's-').replace(/-/g, ' '), // for some reason, it doesnt go well with - or apostrophies
            type: 'movie',
            extended: 'full'
        };
        if (year) {
            searchObj.years = year;
        }
        Trakt.search.text(searchObj).then((summary) => {
            if (!summary.length) {
                reject('Trakt could not find a match');
            } else {
                if (checkTraktSearch(summary[0].movie.title, title)) {
                    match = true;
                    resolve({
                        movie: summary[0].movie,
                        type: 'movie'
                    });
                } else {
                    reject('Trakt search result did not match the filename');
                }
            }
        }).catch(reject);
    });
};

const searchEpisode = (title, season, episode, year) => {
    return new Promise((resolve, reject) => {
        if (!title || (!season && season !== 0) || (!episode && episode !==0)) {
            return reject('Title, season and episode need to be passed');
        }
        if (year && title.indexOf(year) === -1) {
            title += '-' + year;
        }
        // find a matching show
        Trakt.shows.summary({
            id: title,
            extended: 'full'
        }).then((summary) => {
            match = true;
            // find the corresponding episode
            return Trakt.episodes.summary({
                id: title,
                season: season,
                episode: episode,
                extended: 'full'
            }).then((episodeSummary) => {
                resolve({
                    show: summary,
                    episode: episodeSummary,
                    type: 'episode'
                });
            });
        }).catch(reject);
    });
};

/* @params
 * filename: name of the file
 * path: path to the file
 * torrent: torrent title (or magnet dn) containing the file
 */
Matcher.match = (obj) => {
    match = false;

    let file = parseInput(obj);

    let data = {
        quality: detectQuality(file),
        filename: obj.filename || path.basename(obj.path)
    };

    let tests = checkYear(checkApostrophy(formatTitle(file)));
    return Promise.all(tests.title.map((title) => {
        return searchEpisode(title, tests.season, tests.episode, tests.year).then((results) => {
            results.filename = data.filename;
            results.quality = data.quality;
            return {
                error: null,
                data: results
            }
        }).catch(() => {
            if (match) {
                return {
                    error: 'already found',
                    data: null
                };
            }
            return searchMovie(title, tests.year).then((results) => {
                results.filename = data.filename;
                results.quality = data.quality;
                return {
                    error: null,
                    data: results
                }
            }).catch((error) => {
                return {
                    error: error,
                    data: data
                };
            });
        });
    })).then((arr) => {
        for (let i = 0, len = arr.length; i < len; i++) {
            if (arr[i].error === null) {
                return arr[i].data;
            }
        }
        return data;
    });
};
