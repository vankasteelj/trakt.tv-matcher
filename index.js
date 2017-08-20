var Matcher = module.exports = {}; // Skeleton
var Trakt; // the main API for trakt (npm: 'trakt.tv')
var path = require('path');
var parseVideo = require('video-name-parser');
var keywordFilter = require('./keywords_filter.json');
var match; // global used to reduce nb of calls to trakt

// Initialize the module
Matcher.init = function(trakt) {
    Trakt = trakt;
};

var injectPath = function(file, loc) {
    if (!file) {
        file = path.basename(loc);
    }

    return file; // maybe check dir tree some day
};

var injectTorrent = function(file, torrent) {
    var parsed;
    var clean = torrent.match(/.*?(complete.series|complete.season|s\d+|season|\[|hdtv|\W\s)/i);

    if (clean === null || clean[0] === '') {
        parsed = torrent;
    } else {
        parsed = clean[0].replace(clean[1], '').replace(/\s+/, '');
    }

    var regx = new RegExp(parsed.split(/\W/)[0], 'ig');
    var duplicate = file.match(regx);

    if (duplicate === null && parsed.toLowerCase() !== 'from') {
        file = parsed + ' ' + file;
    }

    return file;
};

var parseInput = function(obj) {
    var file;

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

var detectQuality = function(title) {
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

var removeKeywords = function(str) {
    var words = str.split(' ');
    for (var i = 0, leni = words.length; i < leni; i++) {
        for (var j = 0, lenj = keywordFilter.length; j < lenj; j++) {
            if (words[i] === keywordFilter[j]) {
                words[i] = '';
            }
        }
    }
    return words.join(' ').trim();
};

var formatTitle = function(title) {
    var formatted = parseVideo(title);
    if (!formatted.name) {
        formatted.name = title.replace(/[^a-z0-9]/g, '-').replace(/\-+/g, '-').replace(/\-$/, '');
    }

    formatted.name = removeKeywords(formatted.name);

    Trakt._debug('Parsed: ' + formatted.name);
    return {
        title: formatted.name
            .replace(/[^a-z0-9]/g, '-')
            .replace(/\-+/g, '-')
            .replace(/\-$/, ''),
        season: formatted.season,
        episode: formatted.episode,
        year: formatted.year || formatted.aired
    };
};

var checkApostrophy = function(obj) {
    obj.title = [obj.title];

    var matcher = obj.title[0].match(/\w{2}s-/gi);
    if (matcher !== null) {
        for (var i = 0, len = matcher.length; i < len; i++) {
            obj.title.push(obj.title[0].replace(matcher[i], matcher[i].substring(0, 2) + '-s-'));
        }
    }

    return obj;
};

var checkYear = function(obj) {
    if (obj.season && obj.episode) {
        var maybe = '' + obj.season + obj.episode[0];
        if (maybe.match(/19\d{2}|20\d{2}/) !== null && obj.title[0].match(/19\d{2}|20\d{2}/) === null) {
            obj.title.push(obj.title[0] + '-' + maybe);
        }
    }
    return obj;
};

var checkTraktSearch = function(trakt, filename) {
    // stats
    var success = 0,
        fail = 0;

    // words in title
    var words = trakt
        .match(/[\w+\s+]+/ig)[0]
        .split(' ');

    // verification
    for (var i = 0, len = words.length; i < len; i++) {
        // check only words longer than 4 chars
        if (words[i].length >= 3) {
            var regxp = new RegExp(words[i].slice(0, 3), 'ig');
            filename.replace(/\W/ig, '').match(regxp) === null ?
                fail++ :
                success++;
        }
    }

    // avoid /0 errors
    if (success + fail === 0) fail = 1;

    // calc rate
    var successRate = success / (success + fail);
    Trakt._debug('Trakt search matching rate: ' + (successRate * 100) + '%');

    return successRate >= .6;
};

var searchMovie = function(title, year) {
    return new Promise(function(resolve, reject) {
        // find a matching movie
        var searchObj = {
            query: title.replace(/-s-/g, 's-').replace(/-/g, ' '), // for some reason, it doesnt go well with - or apostrophies
            type: 'movie',
            extended: 'full'
        };
        if (year) {
            searchObj.years = year;
        }
        Trakt.search.text(searchObj).then(function(summary) {
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

var searchEpisode = function(title, season, episode, year) {
    return new Promise(function(resolve, reject) {
        if (!title || !season || !episode) {
            return reject('Title, season and episode need to be passed');
        }
        if (year && title.indexOf(year) === -1) {
            title += '-' + year;
        }
        // find a matching show
        Trakt.shows.summary({
            id: title,
            extended: 'full'
        }).then(function(summary) {
            match = true;
            // find the corresponding episode
            return Trakt.episodes.summary({
                id: title,
                season: season,
                episode: episode,
                extended: 'full'
            }).then(function(episodeSummary) {
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
Matcher.match = function(obj) {
    match = false;

    var file = parseInput(obj);

    var data = {
        quality: detectQuality(file),
        filename: obj.filename || path.basename(obj.path)
    };

    var tests = checkYear(checkApostrophy(formatTitle(file)));
    return Promise.all(tests.title.map(function(title) {
        return searchEpisode(title, tests.season, tests.episode, tests.year).then(function(results) {
            results.filename = data.filename;
            results.quality = data.quality;
            return {
                error: null,
                data: results
            }
        }).catch(function() {
            if (match) {
                return {
                    error: 'already found',
                    data: null
                };
            }
            return searchMovie(title, tests.year).then(function(results) {
                results.filename = data.filename;
                results.quality = data.quality;
                return {
                    error: null,
                    data: results
                }
            }).catch(function(error) {
                return {
                    error: error,
                    data: data
                };
            });
        });
    })).then(function(arr) {
        for (var i = 0, len = arr.length; i < len; i++) {
            if (arr[i].error === null) {
                return arr[i].data;
            }
        }
        return data;
    });
};
