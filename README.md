### Trakt.tv Matcher
Extends https://github.com/vankasteelj/trakt.tv node module, in order to match a filename with trakt info. Works around mmmmh 98.5% of the time?

NOTICE: requires trakt.tv module! Load this plugin directly through `trakt.tv` module.

1) Install:

```npm install trakt.tv trakt.tv-matcher```

2) Load the plugin:

```js
const Trakt = require('trakt.tv');
const trakt = new Trakt({
    client_id: '<your id>', // mandatory trakt id
    plugins: {
        matcher: require('trakt.tv-matcher')
    }
});
```

3) Call "matcher":
```js
trakt.matcher.match({
    filename: 'My Awesome Film (2007).mp4',
    path: '/media/Home_Movies'
}).then(console.log);
```

There's also the possibility of passing a torrent's name (found in metadata, or as a magnet DN) in the options to increase chance of matching:

```js
trakt.matcher.match({
    filename: 'My Friend's Awesome Short.avi',
    torrent: 'my.friend.short.thxguyg'
}).then(console.log);
```

---
License MIT, (c) vankasteelj