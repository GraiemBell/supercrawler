var proxyquire = require('proxyquire'),
    sinon = require("sinon"),
    expect = require("chai").expect,
    makeUrl = require("./utils/makeUrl"),
    Promise = require("bluebird"),
    FifoUrlListMock;

// Note: I cannot get sinon's useFakeTimers to behave with Bluebird's
// promises. The calls to .finally(\Function) seem to only be called at the
// last minute. Instead, the tests are using actual timing, which is not ideal.

FifoUrlListMock = function () {
  this.callCount = 0;
  this.delayTime = 1;
};

FifoUrlListMock.prototype.getNextUrl = function () {
  var self = this;

  this.callCount++;

  if (this.callCount >= 20) {
    return Promise.reject(new RangeError("rangeerror"));
  }

  return Promise.delay(this.delayTime).then(function () {
    return makeUrl("https://example.com/index" + self.callCount + ".html");
  });
};

describe("Crawler", function () {
  var Crawler,
      requestSpy,
      insertSpy;

  beforeEach(function () {
    requestSpy = sinon.spy(function (opts, cb) {
      setTimeout(function () {
        cb(null, {
          body: ["User-agent: *",
            "Allow: /",
            "Disallow: /index17.html"
          ].join("\n")
        });
      }, 1);
    });

    insertSpy = sinon.spy(function () {
      return Promise.resolve();
    });

    FifoUrlListMock.prototype.insert = insertSpy;

    Crawler = proxyquire("../lib/Crawler", {
      "./FifoUrlList": FifoUrlListMock,
      "request": requestSpy
    });
  });

  var numCrawlsOfUrl = function (url) {
    var numCalls = 0;
    var n = 0;
    var call;

    while (requestSpy.getCall(n)) {
      call = requestSpy.getCall(n);

      if (call.calledWith(sinon.match({
        url: url,
        forever: true
      }))) {
        numCalls++;
      }

      n++;
    }

    return numCalls;
  };

  var numRobotsCalls = function () {
    return numCrawlsOfUrl("https://example.com/robots.txt");
  };

  it("returns an instance when called as a function", function () {
    expect(Crawler()).to.be.an.instanceOf(Crawler);
  });

  describe("#getUrlList", function () {
    it("if no urlList is specified, defaults to a FifoUrlList", function () {
      var crawler = new Crawler();

      expect(crawler.getUrlList()).to.be.an.instanceOf(FifoUrlListMock);
    });

    it("can use a specified UrlList instance", function () {
      var urlList = new FifoUrlListMock();
      var crawler = new Crawler({
        urlList: urlList
      });

      expect(crawler.getUrlList()).to.equal(urlList);
    });
  });

  describe("#getInterval", function () {
    it("uses a default interval of 1000ms", function () {
      expect(new Crawler().getInterval()).to.equal(1000);
    });

    it("will use a specified interval", function () {
      expect(new Crawler({
        interval: 5000
      }).getInterval()).to.equal(5000);
    });
  });

  describe("#getConcurrentRequestsLimit", function () {
    it("uses a default setting of 5", function () {
      expect(new Crawler().getConcurrentRequestsLimit()).to.equal(5);
    });

    it("will use a specified limit", function () {
      expect(new Crawler({
        concurrentRequestsLimit: 99
      }).getConcurrentRequestsLimit()).to.equal(99);
    });
  });

  describe("#getUserAgent", function () {
    it("uses a default user agent", function () {
      expect(new Crawler().getUserAgent()).to.equal("Mozilla/5.0 " +
        "(compatible; supercrawler/1.0; " +
        "+https://github.com/brendonboshell/supercrawler)");
    });

    it("will use a specified user agent", function () {
      expect(new Crawler({
        userAgent: "mybot/1.1"
      }).getUserAgent()).to.equal("mybot/1.1");
    });
  });

  describe("#start", function () {

    it("returns false if crawl is already running", function () {
      var crawler;

      crawler = new Crawler();
      crawler.start();

      expect(crawler.start()).to.equal(false);
      crawler.stop();
    });

    it("returns true if crawl is not already started", function () {
      var crawler;

      crawler = new Crawler();

      expect(crawler.start()).to.equal(true);
      crawler.stop();
    });

    it("throttles requests according to the interval", function (done) {
      var crawler = new Crawler({
        interval: 50
      });
      var fifoUrlList = crawler.getUrlList();

      crawler.start();

      // call at 0ms, 50ms, 100ms
      setTimeout(function () {
        crawler.stop();
        expect(fifoUrlList.callCount).to.equal(3);
        done();
      }, 130);
    });

    it("obeys the concurrency limit", function (done) {
      var crawler = new Crawler({
        interval: 50,
        concurrentRequestsLimit: 1
      });
      var fifoUrlList = crawler.getUrlList();

      // simulate each request taking 75ms
      fifoUrlList.delayTime = 75;

      crawler.start();

      // call at 0ms finished at 75ms
      // call at 75ms finishes at 150ms
      // call at 150ms finishes at 225ms
      // call at 225ms finsihes at 300ms
      setTimeout(function () {
        crawler.stop();
        expect(fifoUrlList.callCount).to.equal(4);
        done();
      }, 280);
    });

    it("caches robots.txt for a default of 60 minutes", function () {
      var crawler = new Crawler({
        interval: 1000 * 60 * 5, // get page every 5 minutes
        concurrentRequestsLimit: 1
      });

      // There's no easy way to test this without use sinon fakeTimers (see
      // top of this file.)
      expect(crawler._robotsCache.options.stdTTL).to.equal(3600);
    });

    it("caches robots.txt for a specified amount of time", function (done) {
      var crawler = new Crawler({
        interval: 50, // 50 ms
        concurrentRequestsLimit: 1,
        robotsCacheTime: 100 // 100ms
      });

      crawler.start();

      // get robots at 0ms, 100ms, 200ms
      setTimeout(function () {
        crawler.stop();
        expect(numRobotsCalls()).to.equal(3);
        done();
      }, 280);
    });

    it("requests a page that is not excluded by robots.txt", function (done) {
      var crawler = new Crawler({
        interval: 10
      });

      crawler.start();

      setTimeout(function () {
        crawler.stop();
        expect(numCrawlsOfUrl("https://example.com/index18.html")).to.equal(1);
        done();
      }, 200);
    });

    it("skips a page that is excluded by robots.txt", function (done) {
      var crawler = new Crawler({
        interval: 10
      });

      crawler.start();

      setTimeout(function () {
        crawler.stop();
        expect(numCrawlsOfUrl("https://example.com/index17.html")).to.equal(0);
        done();
      }, 200);
    });

    it("updates the error code to ROBOTS_NOT_ALLOWED", function (done) {
      var crawler = new Crawler({
        interval: 10
      });

      crawler.start();

      setTimeout(function () {
        crawler.stop();
        sinon.assert.calledWith(insertSpy, sinon.match({
          _url: "https://example.com/index17.html",
          _errorCode: "ROBOTS_NOT_ALLOWED"
        }));
        done();
      }, 200);
    });
  });
});
