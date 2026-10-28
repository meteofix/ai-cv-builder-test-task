// A stand-in for the PDF worker that never answers: the timer keeps the thread alive, so only the
// extractor's own timeout can end it.
setInterval(() => {}, 1000);
