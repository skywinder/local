web.at('#', function(req, res) {
    if (req.method == 'GET') {
        res.s204().end();
    } else {
        res.s405().end();
    }
});

// web.export(main);
// function main() {
// 	return web.NoContent();
// }