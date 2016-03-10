
// ==========---------- Main Function Starts Here ----------========== //

var zip;
var retryCount = 0;
var imageList = [];
var imageData = [];
var infoStr;
var origin = window.location.origin;
var setting = GM_getValue('ehD-setting') ? JSON.parse(GM_getValue('ehD-setting')) : {};
var fetchCount = 0;
var downloadedCount = 0;
var fetchThread = [];
var dirName;
var fileName;
var failedCount = 0;
var progressTable = null;
var isREH = false;
var needNumberImages = setting['number-images'];
var pagesRange = [];
var isDownloading = false;
var pageURLsList = [];
var getAllPagesURLFin = false;
var xhr = new XMLHttpRequest();
var blobObj = null;

// r.e-hentai.org points all links to g.e-hentai.org
if (origin === 'http://r.e-hentai.org') {
	origin = 'http://g.e-hentai.org';
	isREH = true;
}

var ehDownloadRegex = {
	imageURL: [
		RegExp('<a href="(' + origin.replace(/\./gi, '\\.') + '\/fullimg\\.php\\?\\S+?)"'),
		/<img id="img" src="(\S+?)"/,
		/<\/iframe><a[\s\S]+?><img src="(\S+?)"/
	],
	nextFetchURL: [
		RegExp('<a id="next"[\\s\\S]+?href="(' + origin.replace(/\./gi, '\\.') + '\\/s\\/\\S+?)"'),
		RegExp('<a href="(' + origin.replace(/\./gi, '\\.') + '\\/s\\/\\S+?)"><img src="http://ehgt.org/g/n.png"')
	],
	preFetchURL: RegExp('<div class="sn"><a[\\s\\S]+?href="(' + origin.replace(/\./gi, '\\.') + '\\/s\\/\\S+?)"'),
	nl: /return nl\('([\d-]+)'\)/,
	fileName: /g\/l.png" \/><\/a><\/div><div>([\s\S]+?) :: /,
	resFileName: /filename=([\s\S]+?)\n/,
	dangerChars: /[:"*?|<>\/\\\n]/g,
	pagesRange: /^(\d+(-\d+)?\s*?,\s*?)*\d+(-\d+)?$/,
	pagesURL: /(?:<a href=").+?(?=")/gi
};

window.requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;
var ehDownloadFS = {
	fs: undefined,
	needFileSystem: false,
	initHandler: function(fs) {
		ehDownloadFS.fs = fs;
		console.log('[EHD] File System is opened! Name >', fs.name);
		ehDownloadFS.removeAllFiles(fs); // It's sure that user have downloaded or ignored temp archive
	},
	reinitHandler: function(fs) {
		ehDownloadFS.fs = fs;
		console.log('[EHD] File System is opened! Name >', fs.name);
		ehDownloadFS.removeFile(unsafeWindow.gid + '.zip');
		generateZip();
	},
	errorHandler: function(e) {
		var errorMsg = 'File System Request Error > ';
		switch (e.code) {
			case FileError.QUOTA_EXCEEDED_ERR:
				errorMsg += 'QUOTA_EXCEEDED_ERR';
				break;
			case FileError.NOT_FOUND_ERR:
				errorMsg += 'NOT_FOUND_ERR';
				break;
			case FileError.SECURITY_ERR:
				errorMsg += 'SECURITY_ERR';
				break;
			case FileError.INVALID_MODIFICATION_ERR:
				errorMsg += 'INVALID_MODIFICATION_ERR';
				break;
			case FileError.INVALID_STATE_ERR:
				errorMsg += 'INVALID_STATE_ERR';
				break;
			default:
				errorMsg += 'Unknown Error';
		}
		console.error('[EHD] ' + errorMsg);
	},
	saveAs: function(fs){
		var fs = fs || ehDownloadFS.fs;
		if (fs === undefined) return;
		fs.root.getFile(unsafeWindow.gid + '.zip', {}, function (fileEntry) {
			var url = fileEntry.toURL();
			console.log('[EHD] File URL >', url);
			var a = document.createElement('a');
			a.setAttribute('href', url);
			a.setAttribute('download', fileName + '.zip');
			a.click();
			pushDialog('\n\nNot download or file is broken? <a href="' + url + '" download="' + fileName + '.zip" style="color: #ffffff; font-weight: bold;">Click here to download</a>\n\n');
			insertCloseButton();
		});
	},
	removeFile: function(fileName, fs, isEntry){
		var fs = fs || ehDownloadFS.fs;
		if (fs === undefined) return;
		var removeFunction = function(fileEntry){
			if (fileEntry.isFile) fileEntry.remove(function(){
				console.log('[EHD] File', fileName, 'is removed.');
			}, ehDownloadFS.errorHandler);
			else fileEntry.removeRecursively(function() {
				console.log('[EHD] Directory', fileName, 'is removed.');
			}, ehDownloadFS.errorHandler);
		};
		if (isEntry) removeFunction(fileName);
		else fs.root.getFile(fileName, {create: false}, removeFunction, ehDownloadFS.errorHandler);
	},
	removeAllFiles: function(fs){
		var fs = fs || ehDownloadFS.fs;
		if (fs === undefined) return;
		console.log('[EHD] Request removing all files in File System.');
		fs.root.createReader().readEntries(function(entries){
			if (entries.length === 0) return;
			for (var i = 0; i < entries.length; i++) {
				ehDownloadFS.removeFile(entries[i], fs, true);
			}
		}, ehDownloadFS.errorHandler); 
	},
	initCheckerHandler: function(fs) {
		//ehDownloadFS.fs = fs;
		console.log('[EHD] File System is opened! Name >', fs.name);
		ehDownloadFS.removeFile(unsafeWindow.gid + '.zip');
		fs.root.getFile('config.txt', {create: false}, function(fileEntry){
			fileEntry.file(function(file){
				var fileReader = new FileReader();
				fileReader.onloadend = function() {
					var value = this.result;
					if (value === '' || value == null) return;
					var data = JSON.parse(value);
					if (data && confirm('You have an undownload archive, download it?\n\nFile Name: ' + data.fileName + '\n\n* If you have already downloaded it, click cancel to remove this cached archive.')) {
						fileName = data.fileName;
						dirName = data.dirName;
						ehDownloadFS.storeTempArchive(data, fs);
					}
					else {
						ehDownloadFS.removeAllFiles(fs);
					}
				};
				fileReader.readAsText(file);
			});
		});
	},
	storeTempArchive: function(data, fs){
		var fs = fs || ehDownloadFS.fs;
		if (fs === undefined) return;
		fs.root.getDirectory('raw', {}, function(fileEntry){
			fileEntry.createReader().readEntries(function(entries){
				if (entries.length === 0) return;
				var index = 0;
				var fileReader = new FileReader();
				zip = new JSZip();
				ehDownloadDialog.style.display = 'block';
				ehDownloadDialog.innerHTML = '';
				pushDialog('Preparing......');
				fileReader.onloadend = function() {
					zip.folder(data.dirName).file(entries[index].name, this.result);
					index++;
					if (index < entries.length) addFile();
					else {
						ehDownloadFS.removeAllFiles();
						setTimeout(generateZip, 3000, true, fs); // wait for removing all files
					}
				};
				var addFile = function(){
					console.log('[EHD] TempArchiveFileIndex >', index, '| TempArchiveFileName >', entries[index].name, '| TempArchiveFilePath >', entries[index].fullPath, '| TempArchiveFileLength >', entries.length);
					pushDialog('\n' + (index + 1) + '/' + entries.length);
					fs.root.getFile(entries[index].fullPath, {create: false}, function(fileEntry){
						fileEntry.file(function(file){
							fileReader.readAsArrayBuffer(file);
						});
					});
				};
				addFile();
			}, ehDownloadFS.errorHandler);
		}, ehDownloadFS.errorHandler);
	}
};

var ehDownloadStyle = '\
	.ehD-box { margin: 20px auto; width: 732px; box-sizing: border-box; font-size: 12px; border: 1px groove #000000; }\
	.ehD-box a { cursor: pointer; }\
	.ehD-box .g2 { display: inline-block; margin: 10px; padding: 0; line-height: 14px; }\
	.ehD-setting { position: fixed; left: 0; right: 0; top: 0; bottom: 0; padding: 5px; border: 1px solid #000000; background: #34353b; color: #dddddd; width: 550px; height: 550px; max-width: 100%; max-height: 100%; overflow: auto; box-sizing: border-box; margin: auto; z-index: 999; text-align: left; font-size: 12px; }\
	.ehD-setting .g2 { padding-bottom: 10px; }\
	.ehD-setting input, .ehD-box input { vertical-align: middle; }\
	.ehD-pt {}\
	.ehD-pt-name { word-break: break-all; }\
	.ehD-pt-progress-outer { width: 160px; position: relative; }\
	.ehD-pt-progress { width: 150px; }\
	.ehD-pt-progress-text { position: absolute; width: 100%; text-align: center; color: #34353b; left: 0; right: 0; }\
	.ehD-pt-status { width: 130px; }\
	.ehD-pt-succeed .ehD-pt-status { color: #00ff00; }\
	.ehD-pt-warning .ehD-pt-status { color: #ffff00; }\
	.ehD-pt-failed .ehD-pt-status { color: #ff0000; }\
	.ehD-dialog { position: fixed; right: 0; bottom: 0; display: none; padding: 5px; border: 1px solid #000000; background: #34353b; color: #dddddd; width: 550px; height: 300px; overflow: auto; z-index: 999; }\
	';

// log information
console.log('[EHD] UserAgent >', navigator.userAgent);
console.log('[EHD] Script Handler >', GM_info.scriptHandler || (navigator.userAgent.indexOf('Firefox') >= 0 ? 'GreaseMonkey' : (navigator.userAgent.indexOf('Opera') >= 0 || navigator.userAgent.indexOf('Maxthon') >= 0) ? 'Violentmonkey' : undefined)); // (Only Tampermonkey supports GM_info.scriptHandler)
console.log('[EHD] GreaseMonkey / Tampermonkey Version >', GM_info.version);
console.log('[EHD] E-Hentai Downloader Version >', GM_info.script.version);
console.log('[EHD] E-Hentai Downloader Setting >', JSON.stringify(setting));
console.log('[EHD] Current URL >', window.location.href);
console.log('[EHD] Is Logged In >', unsafeWindow.apiuid !== -1);

// disable single-thread download
if (setting['enable-multi-threading'] === false) {
	delete setting['enable-multi-threading'];
	alert('Single-thread download is unavailable now, because its code is too old and it\'s hard to add new features on it.\n\nIf you still need it, please roll back to the last-supported version (1.17.4).\n\nYou can get it at:\n- GitHub: https://github.com/ccloli/E-Hentai-Downloader/releases\n- GreasyFork: https://greasyfork.org/scripts/10379-e-hentai-downloader/versions (requires log in and enable Adult content)\n- SleazyFork: https://sleazyfork.org/scripts/10379-e-hentai-downloader/versions');
	GM_setValue('ehD-setting', JSON.stringify(setting));
}

String.prototype.replaceHTMLEntites = function() {
	var matchEntity = function(entity) {
		var entitesList = {
			'euro': '€',
			'nbsp': ' ',
			'quot': '"',
			'amp': '&',
			'lt': '<',
			'gt': '>',
			'iexcl': '¡',
			'cent': '¢',
			'pound': '£',
			'curren': '¤',
			'yen': '¥',
			'brvbar': '¦',
			'sect': '§',
			'uml': '¨',
			'copy': '©',
			'ordf': 'ª',
			'not': '¬',
			'shy': '',
			'reg': '®',
			'macr': '¯',
			'deg': '°',
			'plusmn': '±',
			'sup2': '²',
			'sup3': '³',
			'acute': '´',
			'micro': 'µ',
			'para': '¶',
			'middot': '·',
			'cedil': '¸',
			'sup1': '¹',
			'ordm': 'º',
			'raquo': '»',
			'frac14': '¼',
			'frac12': '½',
			'frac34': '¾',
			'iquest': '¿',
			'Agrave': 'À',
			'Aacute': 'Á',
			'Acirc': 'Â',
			'Atilde': 'Ã',
			'Auml': 'Ä',
			'Aring': 'Å',
			'AElig': 'Æ',
			'Ccedil': 'Ç',
			'Egrave': 'È',
			'Eacute': 'É',
			'Ecirc': 'Ê',
			'Euml': 'Ë',
			'Igrave': 'Ì',
			'Iacute': 'Í',
			'Icirc': 'Î',
			'Iuml': 'Ï',
			'ETH': 'Ð',
			'Ntilde': 'Ñ',
			'Ograve': 'Ò',
			'Oacute': 'Ó',
			'Ocirc': 'Ô',
			'Otilde': 'Õ',
			'Ouml': 'Ö',
			'times': '×',
			'Oslash': 'Ø',
			'Ugrave': 'Ù',
			'Uacute': 'Ú',
			'Ucirc': 'Û',
			'Uuml': 'Ü',
			'Yacute': 'Ý',
			'THORN': 'Þ',
			'szlig': 'ß',
			'agrave': 'à',
			'aacute': 'á',
			'acirc': 'â',
			'atilde': 'ã',
			'auml': 'ä',
			'aring': 'å',
			'aelig': 'æ',
			'ccedil': 'ç',
			'egrave': 'è',
			'eacute': 'é',
			'ecirc': 'ê',
			'euml': 'ë',
			'igrave': 'ì',
			'iacute': 'í',
			'icirc': 'î',
			'iuml': 'ï',
			'eth': 'ð',
			'ntilde': 'ñ',
			'ograve': 'ò',
			'oacute': 'ó',
			'ocirc': 'ô',
			'otilde': 'õ',
			'ouml': 'ö',
			'divide': '÷',
			'oslash': 'ø',
			'ugrave': 'ù',
			'uacute': 'ú',
			'ucirc': 'û',
			'uuml': 'ü',
			'yacute': 'ý',
			'thorn': 'þ'
		};
		if (entitesList[entity]) return entitesList[entity];
		else if (entity.match(/#\d+/)) {
			var charCode = entity.match(/#(\d+)/)[1] - 0;
			return String.fromCharCode(charCode);
		}
		else return '&' + entity + ';';
	};
	var result = this.replace(/&(#x?\d+|[a-zA-Z]+);/g, function(match, entity) {
		return matchEntity(entity);
	});
	return result;
};

// Fixed cross origin in r.e-hentai.org
// 发现 prototype 好方便 _(:3
String.prototype.replaceOrigin = function() {
	return isREH ? this.replace('g.e-hentai.org', 'r.e-hentai.org').toString() : this.toString();
};

// show info in dialog box
function pushDialog(str) {
	if (typeof str === 'string') ehDownloadDialog.innerHTML += str.replace(/\n/gi, '<br>');
	else ehDownloadDialog.appendChild(str);
	ehDownloadDialog.scrollTop = ehDownloadDialog.scrollHeight;
}

// replace dir name and zip filename
function getReplacedName(str) {
	return str.replace(/\{gid\}/gi, unsafeWindow.gid)
		.replace(/\{token\}/gi, unsafeWindow.token)
		.replace(/\{title\}/gi, document.getElementById('gn').textContent.replace(/[:"*?|<>\/\\\n]/g, '-'))
		.replace(/\{subtitle\}/gi, document.getElementById('gj').textContent ? document.getElementById('gj').textContent.replace(/[:"*?|<>\/\\\n]/g, '-') : document.getElementById('gn').textContent.replace(/[:"*?|<>\/\\\n]/g, '-'))
		.replace(/\{tag\}/gi, document.querySelector('.ic').getAttribute('alt').toUpperCase())
		.replace(/\{uploader\}/gi, document.querySelector('#gdn a').textContent.replace(/[:"*?|<>\/\\\n]/g, '-'))
		.replaceHTMLEntites();
}

function PageData(pageURL, imageURL, imageName, nextNL, realIndex, imageNumber) {
	this.pageURL = pageURL.split('?')[0];
	this.imageURL = imageURL;
	this.imageName = imageName.trim().replace(/[:"*?|<>\/\\\n]/g, '-');
	this.equalCount = 1;
	this.nextNL = nextNL;
	this.realIndex = realIndex;
	this.imageNumber = imageNumber;
}

// rename images that have the same name
function renameImages() {
	imageList.forEach(function(elem, index) {
		// if Number Images are enabled, filename won't be changed, just numbering
		if (!needNumberImages) {
			for (var i = 0; i < index; i++) {
				if (elem !== undefined && elem.imageName.toLowerCase() === imageList[i]['imageName'].toLowerCase()) {
					var nameParts = elem.imageName.split('.');
					nameParts[nameParts.length - 2] += ' (' + (++imageList[i].equalCount) + ')';
					elem.imageName = nameParts.join('.');
					break;
				}
			}
		}
		else elem['imageName'] = elem['imageNumber'] + (setting['number-separator'] ? setting['number-separator'] : '：') + elem['imageName'];
	});
}

// store responsed content from GM_xhr
// Updated on 1.19: Now the index argument is the page's number - 1 (original is page's number)
function storeRes(res, index) {
	imageData[index] = res;
	downloadedCount++;
	console.log('[EHD] Index >', index + 1, ' | RealIndex >', imageList[index]['realIndex'], ' | Name >', imageList[index]['imageName'], ' | RetryCount >', retryCount[index], ' | DownloadedCount >', downloadedCount, ' | FetchCount >', fetchCount, ' | FailedCount >', failedCount);
	fetchCount--;
	//console.log('[EHD-Debug]', index, 'Res data was stored in imageData!', new Date().getTime());

	if (downloadedCount + failedCount < (pagesRange.length || pageURLsList.length)) { // download not finished, some files are not being called to download

		//console.log('[EHD-Debug]', index, 'Request Downloading...', new Date().getTime());
		requestDownload();
		//console.log('[EHD-Debug]', index, 'OK!', new Date().getTime());
	}
	else if (failedCount > 0) { // all files are called to download and some files can't be downloaded
		if (fetchCount === 0) { // all files are finished downloading
			for (var i = 0; i < fetchThread.length; i++) fetchThread[i].abort();
			if (confirm('Some images were failed to download. Would you like to try them again?')) {
				retryAllFailed();
			}
			else {
				pushDialog('\nFetch images failed.');
				if (confirm('Fetch images failed, Please try again later.\n\nWould you like to download downloaded images?')) {
					renameImages();
					for (var j = 0; j < imageData.length; j++) {
						if (imageData[j] != null && imageData[j] !== 'Fetching') {
							zip.folder(dirName).file(imageList[j]['imageName'], imageData[j]);
							imageData[j] = null;
						}
					}
					generateZip();
				}
				zip.remove(dirName);
				isDownloading = false;
			}
		}
	}
	else { // all files are downloaded successfully
		renameImages();
		for (var j = 0; j < (pagesRange.length || pageURLsList.length); j++) {
			zip.folder(dirName).file(imageList[j]['imageName'], imageData.shift());
		}
		generateZip();
		zip.remove(dirName);
		isDownloading = false;
	}
	
	for (var i in res) {
		delete res[i];
	}
}

function generateZip(isFromFS, fs, isRetry){
	if (!isFromFS && !isRetry) {
		imageList.forEach(function(elem, index){
			infoStr += '\n\nPage ' + elem['realIndex'] + ': ' + elem['pageURL'] + '\nImage ' + elem['realIndex'] + ': ' + elem['imageName'] /*+ '\nImage URL: ' + elem['imageURL']*/; // Image URL may useless, see https://github.com/ccloli/E-Hentai-Downloader/issues/6
		});
		pushDialog('\n\nFinish downloading at ' + new Date());
		infoStr += '\n\nFinish downloading at ' + new Date() + '\n\nGenerated by E-Hentai Downloader. https://github.com/ccloli/E-Hentai-Downloader';
		zip.folder(dirName).file('info.txt', infoStr.replace(/\n/gi, '\r\n'));
	}

	try {
		// build arraybuffer object to detect if it generates successfully
		var abData = zip.generate({type: 'arraybuffer', compression: setting['compression-level'] ? 'DEFLATE' : 'STORE', compressionOptions: {level: setting['compression-level'] > 0 ? (setting['compression-level'] < 10 ? setting['compression-level'] : 9) : 1}});
	}
	catch (error) {
		abData = undefined;

		pushDialog('An error occurred when generating Zip file as ArrayBuffer.');
		console.error('[EHD] An error occurred when generating Zip file as ArrayBuffer.');
		console.error(error);
		if (confirm('An error occurred when generating Zip file as ArrayBuffer. Try again?')) return generateZip(isFromFS, fs, 1);

		if ((isFromFS || ehDownloadFS.needFileSystem) && fs !== undefined) {
			// if enabled file system, then store all files into file system
			pushDialog('Storing files into File System...');
			var files = zip.file(/.*/);
			var fileIndex = 0;
			var filesLength = files.length;
			var initFS = function(r){
				fs = r;
				fs.root.getDirectory('raw', {create: true}, loopWrite, ehDownloadFS.errorHandler);
			};
			var loopWrite = function(){
				fs.root.getFile('raw/' + files[fileIndex]['name'], {create: true}, function(fileEntry){
					fileEntry.createWriter(function(fileWriter){
						console.log('[EHD] FileIndex >', fileIndex, '| FilesLength >', filesLength);
						var blob = new Blob([files[fileIndex].asArrayBuffer()], {type: 'application/octet-stream'});
						fileWriter.write(blob);
						if ('close' in blob) blob.close(); // File Blob.close() API, not supported by all the browser now
						blob = null;
						fileIndex++; // some files may still gone in this way, I have no good way to solve it
						if (fileIndex < filesLength) setTimeout(loopWrite, 100);
						else {
							fs.root.getFile('config.txt', {create: true}, function(fileEntry){
								fileEntry.createWriter(function(fileWriter){
									var t = JSON.stringify({fileName: fileName, dirName: dirName});
									var blob = new Blob([t], {type: 'text/plain'});
									fileWriter.write(blob);
									if ('close' in blob) blob.close(); // File Blob.close() API, not supported by all the browser now
									blob = null;
									pushDialog('Succeed!\nPlease close this tab and open a new tab to download.\nIf you still can\'t download it, try using <a href="https://chrome.google.com/webstore/detail/nhnjmpbdkieehidddbaeajffijockaea">HTML5 FileSystem Explorer</a> to save them.');
								});
							});
						}
					}, ehDownloadFS.errorHandler);
				}, ehDownloadFS.errorHandler);
			};
			window.requestFileSystem(window.TEMPORARY, 1024 * 1024 * 1024 * 1024, initFS, ehDownloadFS.errorHandler);
		}

		return;
	}

	if ((isFromFS || ehDownloadFS.needFileSystem) && fs !== undefined) { // using filesystem to save file is needed
		var fs = fs || ehDownloadFS.fs;
		pushDialog('\n\nSlicing and storing Zip file...');
		var data = abData;
		var dataIndex = 0;
		var dataLength = data.byteLength;
		var loopWrite = function(fileEntry){
			fileEntry.createWriter(function(fileWriter){
				//fileWriter.seek(fileWriter.length);
				dataIndex = fileWriter.length;
				if (dataIndex >= dataLength) {
					data = undefined;
					abData = undefined;
					return setTimeout(function(){
						ehDownloadFS.saveAs(isFromFS ? fs : undefined);
					}, 1500);
				}
				fileWriter.seek(dataIndex);
				var dataLastIndex = dataIndex + 1024 * 1024 * 10;
				// I tried setting it as 100MB but some parts were still gone, so I have to make it smaller.
				console.log('[EHD] DataIndex >', dataIndex, '| DataLastIndex >', dataLastIndex, '| FileWriterLength >', fileWriter.length, '| DataLength >', dataLength);
				pushDialog('\n' + dataIndex + '-' + dataLastIndex + '/' + dataLength);
				var blob = new Blob([data.slice(dataIndex, dataLastIndex)], {type: 'application/zip'});
				fileWriter.write(blob);
				if ('close' in blob) blob.close(); // File Blob.close() API, not supported by all the browser now
				blob = null;
				setTimeout(loopWrite, 100, fileEntry);
			}, ehDownloadFS.errorHandler);
		};
		fs.root.getFile(unsafeWindow.gid + '.zip', {create: true}, loopWrite, ehDownloadFS.errorHandler);
	}
	else { // or just using blob
		try {
			blobObj = new Blob([abData], {type: 'application/zip'});
		}
		catch (error) {
			abData = undefined;

			pushDialog('An error occurred when generating Zip file as Blob.');
			console.error('[EHD] An error occurred when generating Zip file as Blob.');
			console.error(error);
			if (confirm('An error occurred when generating Zip file as Blob. Try again?')) return generateZip(isFromFS, fs, 1);

			return;
		}

		saveAs(blobObj, fileName + '.zip');
		var redownloadBtn = document.createElement('button');
		redownloadBtn.textContent = 'Not download? Click here to download';
		redownloadBtn.addEventListener('click', function(){
			// rebuild blob object if "File is not exist" occured
			blobObj = new Blob([abData], {type: 'application/zip'});
			saveAs(blobObj, fileName + '.zip');
		});
		ehDownloadDialog.appendChild(redownloadBtn);
		insertCloseButton();
	}
}

// update progress table info
function updateProgress(nodeList, data) {
	if (data.name !== undefined) nodeList.fileName.textContent = data.name;
	if (data.progress !== undefined) nodeList.progress.value = data.progress;
	if (data.progressText !== undefined) nodeList.progressText.textContent = data.progressText;
	if (data.status !== undefined) nodeList.status.textContent = data.status;
	if (data.class !== undefined) nodeList.current.className = ['ehD-pt-item', data.class].join(' ').trim();
}

// Updated on 1.19: Now the index argument is the page's number - 1 (original is page's number)
function failedFetching(index, nodeList, forced){
	if ('abort' in fetchThread[index]) fetchThread[index].abort();
	console.error('[EHD] Index >', index + 1, ' | RealIndex >', imageList[index]['realIndex'], ' | Name >', imageList[index]['imageName'], ' | RetryCount >', retryCount[index], ' | DownloadedCount >', downloadedCount, ' | FetchCount >', fetchCount, ' | FailedCount >', failedCount);

	if (!forced && retryCount[index] < (setting['retry-count'] !== undefined ? setting['retry-count'] : 3)) {
		retryCount[index]++;
		fetchOriginalImage(index, nodeList);
	}
	else {
		updateProgress(nodeList, {
			class: 'ehD-pt-failed'
		});

		imageList[index]['imageFinalURL'] = null;
		failedCount++;
		fetchCount--;

		if (downloadedCount + failedCount < (pagesRange.length || pageURLsList.length)) {
			requestDownload();
		}
		// failedCount must > 0
		else if (fetchCount === 0) {
			for (var i = 0; i < fetchThread.length; i++) fetchThread[i].abort();
			if (confirm('Some images were failed to download. Would you like to try them again?')) {
				retryAllFailed();
			}
			else {
				pushDialog('\nFetch images failed.');
				if (confirm('Fetch images failed, Please try again later.\n\nWould you like to download downloaded images?')) {
					renameImages();
					for (var j = 0; j < imageData.length; j++) {
						if (imageData[j] != null && imageData[j] !== 'Fetching') {
							zip.folder(dirName).file(imageList[j]['imageName'], imageData[j]);
							imageData[j] = null;
						}
					}
					generateZip();
				}
				zip.remove(dirName);
				isDownloading = false;
			}
		}
	}
}

// Updated on 1.19: Now the index argument is the page's number - 1 (original is page's number)
function fetchOriginalImage(index, nodeList) {
	// GM_xhr 于 GreaseMonkey 2.3 / 2.4 中开始支持 responseType 以获取返回类型为 ArrayBuffer 的请求
	// GM_xhr support responseType to fetch ArrayBuffer request on 2.3 / 2.4
	// https://github.com/greasemonkey/greasemonkey/issues/1834
	//console.log(imageList[index]);
	if (retryCount[index] === undefined) retryCount[index] = 0;

	if (nodeList === undefined) {
		var node = document.createElement('tr');
		node.className = 'ehD-pt-item';
		node.innerHTML = '\
			<td class="ehD-pt-name">#' + imageList[index]['realIndex'] + ': ' + imageList[index]['imageName'] + '</td>\
			<td class="ehD-pt-progress-outer">\
				<progress class="ehD-pt-progress"></progress>\
				<span class="ehD-pt-progress-text"></span>\
			</td>\
			<td class="ehD-pt-status">Pending...</td>';
		progressTable.appendChild(node);

		nodeList = {
			current: node,
			fileName: node.getElementsByTagName('td')[0],
			status: node.getElementsByTagName('td')[2],
			progress: node.getElementsByTagName('progress')[0],
			progressText: node.getElementsByTagName('span')[0]
		};
	}
	var speedInfo = {
		lastProgress: 0,
		lastTimestamp: new Date().getTime()
	};

	ehDownloadDialog.scrollTop = ehDownloadDialog.scrollHeight;

	fetchThread[index] = GM_xmlhttpRequest({
		method: 'GET',
		url: imageList[index]['imageFinalURL'] || imageList[index]['imageURL'],
		responseType: 'arraybuffer',
		timeout: setting['timeout'] !== undefined ? Number(setting['timeout']) * 1000 : 300000,
		headers: {
			'Referer': imageList[index]['pageURL'],
			'X-Alt-Referer': imageList[index]['pageURL']
		},
		onprogress: function(res) {
			var t = new Date().getTime();
			var speedText;

			if (t - speedInfo.lastTimestamp >= 1000) {
				speedText = res.lengthComputable ? Number((res.loaded - speedInfo.lastProgress) / (t - speedInfo.lastTimestamp) / 1.024).toFixed(2) + ' KB/s' : '';
				speedInfo.lastProgress = res.loaded;
				speedInfo.lastTimestamp = t;
			}

			updateProgress(nodeList, {
				progress: res.lengthComputable ? res.loaded / res.total : '',
				progressText: speedText,
				class: '',
				status: retryCount[index] === 0 ? 'Downloading...' : 'Retrying (' + retryCount[index] + '/' + (setting['retry-count'] !== undefined ? setting['retry-count'] : 3) +') ...'
			});

			for (var i in res) {
				delete res[i];
			}
		},
		onload: function(res) {
			//console.log('[EHD-Debug]', index, 'Load Finished!', new Date().getTime());

			// cache them to reduce waiting time and CPU usage on Chrome
			// now store progress just spent ~1s instead of ~8s
			var response = res.response;
			var byteLength = response.byteLength;
			var responseHeaders = res.responseHeaders;

			if (!response) {
				console.log('[EHD] #' + (index + 1) + ': Empty Response (See: https://github.com/ccloli/E-Hentai-Downloader/issues/16 )');
				console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index]['realIndex'], ' | ReadyState >', res.readyState, ' | Status >', res.status, ' | StatusText >', res.statusText + '\nResposeHeaders >' + res.responseHeaders);

				updateProgress(nodeList, {
					status: 'Failed! (Empty Response)',
					progress: '0',
					progressText: '',
					class: 'ehD-pt-warning'
				});

				for (var i in res) {
					delete res[i];
				}
				return failedFetching(index, nodeList);

				// res.response polyfill is useless, so it has been removed
			}
			else if (byteLength === 925) { // '403 Access Denied' Image Byte Size
				// GM_xhr only support abort()
				console.log('[EHD] #' + (index + 1) + ': 403 Access Denied');
				console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index]['realIndex'], ' | ReadyState >', res.readyState, ' | Status >', res.status, ' | StatusText >', res.statusText + '\nResposeHeaders >' + res.responseHeaders);

				updateProgress(nodeList, {
					status: 'Failed! (Error 403)',
					progress: '0',
					progressText: '',
					class: 'ehD-pt-warning'
				});

				for (var i in res) {
					delete res[i];
				}
				return failedFetching(index, nodeList, true);
			}
			else if (byteLength === 28) { // 'An error has occurred. (403)' Length
				console.log('[EHD] #' + (index + 1) + ': An error has occurred. (403)');
				console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index]['realIndex'], ' | ReadyState >', res.readyState, ' | Status >', res.status, ' | StatusText >', res.statusText + '\nResposeHeaders >' + res.responseHeaders);
				
				updateProgress(nodeList, {
					status: 'Failed! (Error 403)',
					progress: '0',
					progressText: '',
					class: 'ehD-pt-warning'
				});

				for (var i in res) {
					delete res[i];
				}
				return failedFetching(index, nodeList, true);
			}
			else if (byteLength === 141) { // Image Viewing Limits String Byte Size
				for (var i = 0; i < fetchThread.length; i++) fetchThread[i].abort();
				console.log('[EHD] #' + (index + 1) + ': Exceed Image Viewing Limits');
				console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index]['realIndex'], ' | ReadyState >', res.readyState, ' | Status >', res.status, ' | StatusText >', res.statusText + '\nResposeHeaders >' + res.responseHeaders);

				updateProgress(nodeList, {
					status: 'Failed! (Exceed Limits)',
					progress: '0',
					progressText: '',
					class: 'ehD-pt-failed'
				});

				for (var i in res) {
					delete res[i];
				}

				pushDialog('\nYou have exceeded your image viewing limits.');
				if (confirm('You have exceeded your image viewing limits. You can reset these limits at home page.\n\nYou can try reseting your image viewing limits to continue by paying your GPs. Reset now?') && (unsafeWindow.apiuid !== -1 ? 1 : (alert('Sorry, you are not log in!'), 0))) {
					window.open('http://g.e-hentai.org/home.php');
					pushDialog('Please reset your viewing limits on opened window. If not shown, try this <a href="http://g.e-hentai.org/home.php" target="_blank">link</a>.\nAfter reseting your viewing limits, click the button below to continue.\n');
					var continueButton = document.createElement('button');
					continueButton.innerHTML = 'Continue Downloading';
					continueButton.addEventListener('click', function(){
						fetchCount = 0;
						ehDownloadDialog.removeChild(continueButton);

						requestDownload();
					});
					ehDownloadDialog.appendChild(continueButton);
					return;
				}
				else if (confirm('You have exceeded your image viewing limits. Would you like to save downloaded images?')) {
					renameImages();
					for (var j = 0; j < imageData.length; j++) {
						if (imageData[j] != null && imageData[j] !== 'Fetching') {
							zip.folder(dirName).file(imageList[j]['imageName'], imageData[j]);
							imageData[j] = null;
						}
					}
					generateZip();
				}
				zip.remove(dirName);
				isDownloading = false;
				return;
			}
			else if (byteLength === 28658) { // '509 Bandwidth Exceeded' Image Byte Size
				for (var i = 0; i < fetchThread.length; i++) fetchThread[i].abort();
				console.log('[EHD] #' + (index + 1) + ': 509 Bandwidth Exceeded');
				console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index]['realIndex'], ' | ReadyState >', res.readyState, ' | Status >', res.status, ' | StatusText >', res.statusText + '\nResposeHeaders >' + res.responseHeaders);

				updateProgress(nodeList, {
					status: 'Failed! (Error 509)',
					progress: '0',
					progressText: '',
					class: 'ehD-pt-failed'
				});

				pushDialog('\nYou have exceeded your bandwidth limits.');

				for (var i in res) {
					delete res[i];
				}
				if (confirm('You have temporarily reached the limit for how many images you can browse. You can\n- Sign up/in E-Hentai account at E-Hentai Forums to get double daily quota if you are not sign in.\n- Run the Hentai@Home to support E-Hentai and get more points to increase your limit.\n- Check back in a few hours, and you will be able to download more.\n\nYou can try reseting your image viewing limits to continue by paying your GPs. Reset now?') && (unsafeWindow.apiuid !== -1 ? 1 : (alert('Sorry, you are not log in!'), 0))) {
					window.open('http://g.e-hentai.org/home.php');
					pushDialog('Please reset your viewing limits on opened window. If not shown, try this <a href="http://g.e-hentai.org/home.php" target="_blank">link</a>.\nAfter reseting your viewing limits, click the button below to continue.\n');
					var continueButton = document.createElement('button');
					continueButton.innerHTML = 'Continue Downloading';
					continueButton.addEventListener('click', function(){
						fetchCount = 0;
						ehDownloadDialog.removeChild(continueButton);

						requestDownload();
					});
					ehDownloadDialog.appendChild(continueButton);
					return;
				}
				else if (confirm('You have exceeded your image viewing limits. Would you like to save downloaded images?')) {
					renameImages();
					for (var j = 0; j < imageData.length; j++) {
						if (imageData[j] != null && imageData[j] !== 'Fetching') {
							zip.folder(dirName).file(imageList[j]['imageName'], imageData[j]);
							imageData[j] = null;
						}
					}
					generateZip();
				}
				zip.remove(dirName);
				isDownloading = false;
				return;
			}
			// res.status should be detected at here, because we should know are we reached image limits at first
			if (res.status !== 200) {
				console.log('[EHD] #' + (index + 1) + ': Wrong Response Status');
				console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index]['realIndex'], ' | ReadyState >', res.readyState, ' | Status >', res.status, ' | StatusText >', res.statusText + '\nResposeHeaders >' + res.responseHeaders);

				updateProgress(nodeList, {
					status: 'Failed! (Wrong Status)',
					progress: '0',
					progressText: '',
					class: 'ehD-pt-warning'
				});

				for (var i in res) {
					delete res[i];
				}
				return failedFetching(index, nodeList);
			}
			// GM_xhr doesn't support xhr.getResponseHeader() function
			//if (res.getResponseHeader('Content-Type').split('/')[0] != 'image') {
			else if (res.responseHeaders.indexOf('Content-Type:') < 0 || res.responseHeaders.split('Content-Type:')[1].split('\n')[0].split('/')[0].trim() !== 'image') {
				console.log('[EHD] #' + (index + 1) + ': Wrong Content-Type');
				console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index]['realIndex'], ' | ReadyState >', res.readyState, ' | Status >', res.status, ' | StatusText >', res.statusText + '\nResposeHeaders >' + res.responseHeaders);

				updateProgress(nodeList, {
					status: 'Failed! (Wrong MIME)',
					progress: '0',
					progressText: '',
					class: 'ehD-pt-warning'
				});

				for (var i in res) {
					delete res[i];
				}
				return failedFetching(index, nodeList);
			}

			//console.log('[EHD-Debug]', index, 'Available Testing Finished!', new Date().getTime());
			imageList[index]['imageName'] = res.responseHeaders.match(ehDownloadRegex.resFileName) ? res.responseHeaders.match(ehDownloadRegex.resFileName)[1].trim().replace(ehDownloadRegex.dangerChars, '-') : imageList[index]['imageName'];
			//console.log('[EHD-Debug]', index, 'File name was modified!', new Date().getTime());

			updateProgress(nodeList, {
				name: '#' + imageList[index]['realIndex'] + ': ' + imageList[index]['imageName'],
				status: 'Succeed!',
				progress: '1',
				progressText: '100%',
				class: 'ehD-pt-succeed'
			});
			//console.log('[EHD-Debug]', index, 'Progress was updated!', new Date().getTime());

			storeRes(response, index);
			//console.log('[EHD-Debug]', index, 'Data was saved!', new Date().getTime());

			for (var i in res) {
				delete res[i];
			}
			response = null;
			//console.log('[EHD-Debug]', index, 'Res was deleted!', new Date().getTime());
		},
		onerror: function(res){
			console.log('[EHD] #' + (index + 1) + ': Network Error');
			console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index]['realIndex'], ' | ReadyState >', res.readyState, ' | Status >', res.status, ' | StatusText >', res.statusText + '\nResposeHeaders >' + res.responseHeaders);

			updateProgress(nodeList, {
				status: 'Failed! (Network Error)',
				progress: '0',
				progressText: '',
				class: 'ehD-pt-warning'
			});

			if (imageList[index]['imageURL'].indexOf('fullimg.php') >= 0) imageList[index]['imageFinalURL'] = res.finalUrl;

			for (var i in res) {
				delete res[i];
			}

			failedFetching(index, nodeList);
		},
		ontimeout: function(res){
			console.log('[EHD] #' + (index + 1) + ': Timed Out');
			console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index]['realIndex'], ' | ReadyState >', res.readyState, ' | Status >', res.status, ' | StatusText >', res.statusText + '\nResposeHeaders >' + res.responseHeaders);

			updateProgress(nodeList, {
				status: 'Failed! (Timed Out)',
				progress: '0',
				progressText: '',
				class: 'ehD-pt-warning'
			});

			if (imageList[index]['imageURL'].indexOf('fullimg.php') >= 0) imageList[index]['imageFinalURL'] = res.finalUrl;

			for (var i in res) {
				delete res[i];
			}

			failedFetching(index, nodeList);
		}
	});
}

function retryAllFailed(){
	var index, refetch = 0;
	initProgressTable();

	for (index = 0; index < imageData.length; index++) {
		if (imageData[index] === 'Fetching') {
			imageData[index] = null;
			retryCount[index] = 0;
		}
	}

	failedCount = 0;
	requestDownload();
}

function insertCloseButton() {
	var exitButton = document.createElement('button');
	exitButton.style.display = 'block';
	exitButton.style.margin = '0 auto';
	exitButton.textContent = 'Close';
	exitButton.onclick = function(){
		ehDownloadDialog.removeChild(exitButton);
		ehDownloadDialog.style.display = 'none';
		if (ehDownloadFS.needFileSystem) ehDownloadFS.removeFile(unsafeWindow.gid + '.zip');

		if (blobObj !== null) {
			if ('close' in blobObj) blobObj.close();
			blobObj = null;
		}
	};
	ehDownloadDialog.appendChild(exitButton);
	ehDownloadDialog.scrollTop = ehDownloadDialog.scrollHeight;
}

// /*if pages range is set, then*/ get all pages URL to select needed pages
function getAllPagesURL() {
	pagesRange = [];
	var pagesRangeText = ehDownloadRange.querySelector('input').value.replace(/，/g, ',').trim();
	var retryCount = 0;

	if (pagesRangeText) { // if pages range is defined
		console.log('[EHD] Pages Range >', pagesRangeText);
		if (!ehDownloadRegex.pagesRange.test(pagesRangeText)) return alert('Pages Range is not correct.');

		var pagesRangeScale = pagesRangeText.match(/\d+-\d+|\d+/g);
		pagesRangeScale.forEach(function(elem){
			if (elem.indexOf('-') < 0) {
				var curElem = Number(elem);
				if (!pagesRange.some(function(e){ return curElem === e; })) pagesRange.push(curElem);
			}
			else {
				var curElem = [Number(elem.split('-')[0]), Number(elem.split('-')[1])].sort(function(a, b){ return a - b; });
				for (var i = curElem[0]; i <= curElem[1]; i++) {
					if (!pagesRange.some(function(e){ return i === e; })) pagesRange.push(i);
				}
			}
		});
		pagesRange.sort(function(a, b){ return a - b; });
	}

	ehDownloadDialog.style.display = 'block';
	if (!getAllPagesURLFin) {
		pageURLsList = [];
		var pagesLength = [].reduce.call(document.querySelectorAll('.ptt td'), function(x, y){
			var i = Number(y.textContent);
			if (!isNaN(i)) return x > i ? x : i;
			else return x;
		});
		var curPage = 0;
		retryCount = 0;

		var xhr = new XMLHttpRequest();
		xhr.onload = function(){
			if (xhr.status !== 200 || !xhr.responseText) {
				if (retryCount < (setting['retry-count'] !== undefined ? setting['retry-count'] : 3)) {
					pushDialog('Failed! Retrying... ');
					retryCount++;
					xhr.open('GET', location.pathname + '?p=' + curPage);
					xhr.timeout = 30000;
					xhr.send();
				}
				else {
					pushDialog('Failed!\nFetch Pages\' URL failed, Please try again later.');
					isDownloading = false;
					alert('Fetch Pages\' URL failed, Please try again later.');
				}
			}

			var pagesURL = xhr.responseText.split('<div id="gdt">')[1].split('<div class="c">')[0].match(ehDownloadRegex.pagesURL);
			for (var i = 0; i < pagesURL.length; i++) {
				pageURLsList.push(pagesURL[i].split('"')[1].replaceHTMLEntites().replaceOrigin());
			}
			pushDialog('Succeed!');

			curPage++;
			if (curPage === pagesLength) {
				getAllPagesURLFin = true;
				var wrongPages = pagesRange.filter(function(elem){ return elem > pageURLsList.length; });
				if (wrongPages.length !== 0) {
					pagesRange = pagesRange.filter(function(elem){ return elem <= pageURLsList.length; });
					pushDialog('\nPage ' + wrongPages.join(', ') + (wrongPages.length > 1 ? ' are' : ' is') + ' not exist, and will be ignored.\n');
					if (pagesRange.length === 0) {
						pushDialog('There is no content that matching pages range.');
						alert('There is no content that matching pages range.');
						insertCloseButton();
						return;
					}
				}
				pushDialog('\n\n');
				initProgressTable();
				requestDownload();
			}
			else {
				xhr.open('GET', location.pathname + '?p=' + curPage);
				xhr.send();
				pushDialog('\nFetching Archive Pages URL (' + (curPage + 1) + '/' + pagesLength + ') ... ');
			}
		};
		xhr.ontimeout = xhr.onerror = function(){
			if (retryCount < (setting['retry-count'] !== undefined ? setting['retry-count'] : 3)) {
				pushDialog('Failed! Retrying... ');
				retryCount++;
				xhr.open('GET', location.pathname + '?p=' + curPage);
				xhr.timeout = 30000;
				xhr.send();
			}
			else {
				pushDialog('Failed!\nFetch Pages\' URL failed, Please try again later.');
				isDownloading = false;
				alert('Fetch Pages\' URL failed, Please try again later.');
			}
		};
		xhr.open('GET', location.pathname + '?p=' + curPage);
		xhr.timeout = 30000;
		xhr.send();
		pushDialog('\nFetching Archive Pages URL (' + (curPage + 1) + '/' + pagesLength + ') ... ');
	}
	else {
		var wrongPages = pagesRange.filter(function(elem){ return elem > pageURLsList.length; });
		if (wrongPages.length !== 0) {
			pagesRange = pagesRange.filter(function(elem){ return elem <= pageURLsList.length; });
			pushDialog('\nPage ' + wrongPages.join(', ') + (wrongPages.length > 1 ? ' are' : ' is') + ' not exist, and will be ignored.\n');
			if (pagesRange.length === 0) {
				pushDialog('There is no content that matching pages range.');
				alert('There is no content that matching pages range.');
				insertCloseButton();
				return;
			}
		}
		pushDialog('\n\n');
		initProgressTable();
		requestDownload();
	}
}

function initEHDownload() {
	xhr.abort();
	for (var i = 0; i < fetchThread.length; i++) fetchThread[i].abort();
	if (blobObj !== null) {
		if ('close' in blobObj) blobObj.close();
		blobObj = null;
	}
	imageList = [];
	imageData = [];
	fetchThread = [];
	retryCount = [];
	downloadedCount = fetchCount = failedCount = 0;
	zip = new JSZip();

	dirName = getReplacedName(!setting['dir-name'] ? '{gid}_{token}' : setting['dir-name']);
	fileName = getReplacedName(!setting['file-name'] ? '{title}' : setting['file-name']);
	if (dirName === '/') dirName = '';
	needNumberImages = ehDownloadNumberInput.querySelector('input').checked;

	infoStr = document.getElementById('gn').textContent.replaceHTMLEntites() + '\n' 
	        + document.getElementById('gj').textContent.replaceHTMLEntites() + '\n' 
	        + window.location.href.replaceHTMLEntites() + '\n\n'
	        + 'Category: ' + document.getElementsByClassName('ic')[0].getAttribute('alt').toUpperCase() + '\n' 
	        + 'Uploader: ' + document.querySelector('#gdn a').textContent.replaceHTMLEntites() + '\n';
	var metaNodes = document.querySelectorAll('#gdd tr');
	for (var i = 0; i < metaNodes.length; i++) {
		var c1 = metaNodes[i].getElementsByClassName('gdt1')[0].textContent.replaceHTMLEntites();
		var c2 = metaNodes[i].getElementsByClassName('gdt2')[0].textContent.replaceHTMLEntites();
		infoStr += c1 + ' ' + c2 + '\n';
		if (c1 === 'File Size:' && (c2.indexOf('GB') > 0 || (c2.indexOf('MB') > 0 && parseFloat(c2) >= 200))) {
			if ((!setting['store-in-fs'] || !window.requestFileSystem) && (c2.indexOf('GB') > 0 || (c2.indexOf('MB') > 0 && parseFloat(c2) >= 450)) && !confirm('This archive is too large (original size), please consider downloading this archive in other way.\n\nMaximum allowed file size: Chrome / Opera 15+ 500MB | IE 10+ 600 MB | Firefox 20+ 800 MB\n(From FileSaver.js introduction)\n\nAre you sure to continue downloading? Please also consider your operating system\'s free memory, it may takes about double size of archive file size when generating ZIP file.\n\n* If you are using Chrome, you can try enabling "Request File System to handle large Zip file" on settings page.\n\n* You can set Pages Range to download this archive into some parts. If you have already enabled it, please ignore this message.')) return;
			else if (setting['store-in-fs'] && window.requestFileSystem) {
				ehDownloadFS.needFileSystem = true;
				var requiredBytes = parseInt(1024 * 1024 * ((c2.indexOf('MB') > 0 ? parseFloat(c2) : parseFloat(c2) * 1024) * 1.05));
				console.log('[EHD] Required File System Space >', requiredBytes);

				// Chrome can use about 10% of free space of disk where Chrome User Data stored in as TEMPORARY File System Storage.
				if (navigator.webkitTemporaryStorage) { // if support navigator.webkitTemporaryStorage to check usable space
					navigator.webkitTemporaryStorage.requestQuota(requiredBytes , function (grantedBytes) {
						console.log('[EHD] Free TEMPORARY File System Space >', grantedBytes);
						if (grantedBytes < requiredBytes) {
							console.log('[EHD] Free TEMPORARY File System Space is not enough.');

							// free space is not enough, then use persistent space
							// in fact, free space of persisent file storage is always 10GiB, even free disk space is not enough
							navigator.webkitPersistentStorage.requestQuota(requiredBytes , function (grantedBytes) {
								console.log('[EHD] Free PERSISTENT File System Space >', grantedBytes);
								if (grantedBytes < requiredBytes) {
									// roll back and use Blob to handle file
									ehDownloadFS.needFileSystem = false;
									alert('You don\'t have enough free space where Chrome stored user data in (Default is system disk, normally it\'s C:), please delete some file.\n\nNeeded more than ' + (requiredBytes - grantedBytes) + ' Bytes.\n\nRoll back and use Blob to handle file.');
									if ((c2.indexOf('GB') > 0 || (c2.indexOf('MB') > 0 && parseFloat(c2) >= 450)) && !confirm('This archive is too large (original size), please consider downloading this archive in other way.\n\nMaximum allowed file size: Chrome / Opera 15+ 500MB | IE 10+ 600 MB | Firefox 20+ 800 MB\n(From FileSaver.js introduction)\n\nAre you sure to continue downloading? Please also consider your operating system\'s free memory, it may takes about double size of archive file size when generating ZIP file.\n\n* You can set Pages Range to download this archive into some parts. If you have already enabled it, please ignore this message.')) return;
								}
								else {
									pushDialog('\n<strong>Please allow storing large content if browser asked a request.</strong>\n');
									window.requestFileSystem(window.PERSISTENT, requiredBytes, ehDownloadFS.initHandler, ehDownloadFS.errorHandler);
								}
							}, ehDownloadFS.errorHandler);
						}
						else window.requestFileSystem(window.TEMPORARY, requiredBytes, ehDownloadFS.initHandler, ehDownloadFS.errorHandler);
					}, ehDownloadFS.errorHandler);
				}
				else window.requestFileSystem(window.TEMPORARY, requiredBytes, ehDownloadFS.initHandler, ehDownloadFS.errorHandler);
			}
		}
	}
	infoStr += 'Rating: ' + unsafeWindow.original_rating + '\n\n';
	if (document.getElementById('comment_0')) {
		infoStr += 'Uploader Comment:\n' + document.getElementById('comment_0').innerHTML.replace(/<br>|<br \/>/gi, '\n') + '\n\n';
	}
	isDownloading = true;
	pushDialog(infoStr);

	pushDialog('Start downloading at ' + new Date() + '\n');

	// get all pages url to fix 403 forbidden (download request was timed out)
	getAllPagesURL();
}

function initProgressTable(){
	progressTable = document.createElement('table');
	progressTable.style.width = '100%';
	ehDownloadDialog.style.display = 'block';
	ehDownloadDialog.appendChild(progressTable);
}

function requestDownload(){
	var i = fetchCount, j = 0;
	for (/*var i = fetchCount*/; i < (setting['thread-count'] !== undefined ? setting['thread-count'] : 5); i++) {
		for (/*var j = 0*/; j < (pagesRange.length || pageURLsList.length); j++) {
			if (imageData[j] == null) {
				imageData[j] = 'Fetching';
				if (imageList[j] && setting['never-new-url']) fetchOriginalImage(j);
				else getPageData(j);
				fetchCount++;
				break;
			}
		}
	}

}

function getPageData(index) {
	if (pagesRange.length) var realIndex = pagesRange[index];
	else var realIndex = index + 1;

	var node = document.createElement('tr');
	node.className = 'ehD-pt-item';
	node.innerHTML = '\
		<td class="ehD-pt-name">#' + realIndex + '</td>\
		<td class="ehD-pt-progress-outer">\
			<progress class="ehD-pt-progress"></progress>\
			<span class="ehD-pt-progress-text"></span>\
		</td>\
		<td class="ehD-pt-status">Fetching URL...</td>';
	progressTable.appendChild(node);

	var nodeList = {
		current: node,
		fileName: node.getElementsByTagName('td')[0],
		status: node.getElementsByTagName('td')[2],
		progress: node.getElementsByTagName('progress')[0],
		progressText: node.getElementsByTagName('span')[0]
	};

	var retryCount = 0;
	var fetchURL = imageList[index] ? (imageList[index]['pageURL'] + ((!setting['never-send-nl'] && imageList[index]['nextNL']) ? (imageList[index]['pageURL'].indexOf('?') >= 0 ? '&' : '?') + 'nl=' + imageList[index]['nextNL'] : '')).replaceHTMLEntites() : pageURLsList[realIndex - 1];
	var xhr = new XMLHttpRequest();
	xhr.onload = function() {
		if (xhr.status !== 200 || !xhr.responseText) {
			if (retryCount < (setting['retry-count'] !== undefined ? setting['retry-count'] : 3)) {
				//pushDialog('Failed! Retrying... ');
				updateProgress(nodeList, {
					status: 'Retrying (' + retryCount + ')...',
					progress: '',
					progressText: '',
					class: 'ehD-pt-warning'
				});
				retryCount++;
				xhr.open('GET', fetchURL);
				xhr.timeout = 30000;
				xhr.send();
			}
			else {
				failedCount++;

				console.error('[EHD] #' + realIndex + ': Failed getting image URL');
				updateProgress(nodeList, {
					status: 'Failed getting URL',
					progress: '0',
					progressText: '',
					class: 'ehD-pt-failed'
				});

				requestDownload();
			}
		}

		var imageURL = (unsafeWindow.apiuid !== -1 && xhr.responseText.indexOf('fullimg.php') >= 0 && !setting['force-resized']) ? xhr.responseText.match(ehDownloadRegex.imageURL[0])[1].replaceHTMLEntites().replaceOrigin() : xhr.responseText.indexOf('id="img"') > -1 ? xhr.responseText.match(ehDownloadRegex.imageURL[1])[1].replaceHTMLEntites() : xhr.responseText.match(ehDownloadRegex.imageURL[2])[1].replaceHTMLEntites(); // Sometimes preview image may not have id="img"
		var fileName = xhr.responseText.match(ehDownloadRegex.fileName)[1].replaceHTMLEntites();
		var nextNL = ehDownloadRegex.nl.test(xhr.responseText) ? xhr.responseText.match(ehDownloadRegex.nl)[1] : null;
		var imageNumber = '';
		if (needNumberImages) {
			// Number images, thanks to JingJang@GitHub, source: https://github.com/JingJang/E-Hentai-Downloader
			if (!setting['number-real-index'] && pagesRange.length) { // if pages range was set and number original index is not required
				var len = pagesRange.length.toString().length + 1,
					padding = new Array(len < 3 ? len + 1 : len).join('0');
				imageNumber = (padding + (index + 1)).slice(0 - len);
			}
			else { // pages range was not set (download all pages, so index + 1 === realIndex) or number original index is required
				var len = pageURLsList.length.toString().length + 1,
					padding = new Array(len < 3 ? len + 1 : len).join('0');
				imageNumber = (padding + realIndex).slice(0 - len);
			}
	 	}

		//imageList.push(new PageData(fetchURL, imageURL, fileName, nextNL, realIndex));
		imageList[index] = new PageData(fetchURL, imageURL, fileName, nextNL, realIndex, imageNumber);

		updateProgress(nodeList, {
			name: '#' + realIndex + ': ' + fileName,
			status: 'Pending...',
			progress: '',
			progressText: '', 
			class: ''
		});

		fetchOriginalImage(index, nodeList);

	};
	xhr.onerror = xhr.ontimeout = function() {
		if (retryCount < (setting['retry-count'] !== undefined ? setting['retry-count'] : 3)) {
			//pushDialog('Failed! Retrying... ');
			updateProgress(nodeList, {
				status: 'Retrying (' + retryCount + ')...',
				progress: '',
				progressText: '',
				class: 'ehD-pt-warning'
			});
			retryCount++;
			xhr.open('GET', fetchURL);
			xhr.timeout = 30000;
			xhr.send();
		}
		else {
			failedCount++;

			console.error('[EHD] #' + realIndex + ': Failed getting image URL');
			updateProgress(nodeList, {
				status: 'Failed getting URL',
				progress: '0',
				progressText: '',
				class: 'ehD-pt-failed'
			});

			requestDownload();
		}
	};

	
	xhr.open('GET', fetchURL);
	xhr.timeout = 30000;
	xhr.send();
}

function showSettings() {
	var ehDownloadSettingPanel = document.createElement('div');
	ehDownloadSettingPanel.className = 'ehD-setting';
	ehDownloadSettingPanel.innerHTML = '\
			<div class="g2"><label>Download <input type="number" data-ehd-setting="thread-count" min="1" placeholder="5" style="width: 51px;"> images at the same time (<=5 is advised)</label></div>\
			<div class="g2"><label>Abort fetching current image after <input type="number" data-ehd-setting="timeout" min="0" placeholder="300" style="width: 51px;"> second(s) (0 is never abort)</label></div>\
			<div class="g2"' + ((GM_info.scriptHandler && GM_info.scriptHandler === 'Violentmonkey') ? ' style="opacity: 0.5;" title="Violentmonkey may not support this feature"' : '') + '><label>Skip current image when retried <input type="number" data-ehd-setting="retry-count" min="1" placeholder="3" style="width: 51px;"> time(s)</label></div>\
			<div class="g2"><label>Set folder name as <input type="text" data-ehd-setting="dir-name" placeholder="{gid}_{token}"> (if you don\'t want to create folder, use "/") *</label></div>\
			<div class="g2"><label>Set Zip file name as <input type="text" data-ehd-setting="file-name" placeholder="{title}"> *</label></div>\
			<div class="g2"><label>Set compression level as <input type="number" data-ehd-setting="compression-level" min="0" max="9" placeholder="0" style="width: 51px;"> (0 ~ 9, 0 is only store, not recommended to enable)</label></div>\
			<div class="g2"><label><input type="checkbox" data-ehd-setting="number-images"> Number images (001：01.jpg, 002：01_theme.jpg, 003：02.jpg...) (Separator <input type="text" data-ehd-setting="number-separator" style="width: 51px;" placeholder="：">)</label></div>\
			<div class="g2"><label><input type="checkbox" data-ehd-setting="number-real-index"> Number images with original page number if pages range is set</label></div>\
			<div class="g2"><label><input type="checkbox" data-ehd-setting="force-resized"> Force download resized image (never download original image) **</label></div>\
			<div class="g2"><label><input type="checkbox" data-ehd-setting="never-new-url"> Never get new image URL when failed downloading image **</label></div>\
			<div class="g2"><label><input type="checkbox" data-ehd-setting="never-send-nl"> Never send "nl" GET parameter when getting new image URL **</label></div>\
			<div class="g2"' + (window.requestFileSystem ? '' : ' style="opacity: 0.5;" title="Only Chrome support this feature"') + '><label><input type="checkbox" data-ehd-setting="store-in-fs"> Request File System to handle large Zip file (experiment, Chrome only) +</label></div>\
			<!--<div class="g2"><label><input type="checkbox" data-ehd-setting="auto-scale"> Auto scale Zip file at <input type="text" min="10" placeholder="250" style="width: 51px;" data-ehd-setting="scale-size"> MB if file is larger than <input type="text" min="10" placeholder="400" style="width: 51px;" data-ehd-setting="scale-reach"> MB (experiment) ***</label></div>-->\
			<div class="g2">\
				* Enabled tags: \
				<span title="You can find GID and token at the address bar like this: exhentai.org/g/[GID]/[Token]/">{gid} Archive\'s GID</sapn> | \
				<span title="You can find GID and token at the address bar like this: exhentai.org/g/[GID]/[Token]/">{token} Archive\'s token</sapn> | \
				<span title="This title is the English title or Latin transliteration, you can find it as the first line of the title.">{title} Archive\'s title</span> | \
				<span title="This title is the original language title, you can find it as the second line of the title.">{subtitle} Archive\'s sub-title</span> | \
				<span title="This tag means the sort name of the archive, and its output string is upper.">{tag} Archive\'s tag</span> | \
				<span title="You can find it at the left of the archive page.">{uploader} Archive\'s uploader</span>\
			</div>\
			<div class="g2">\
				** Enable these options may save your image viewing limits <i><a href="https://github.com/ccloli/E-Hentai-Downloader/wiki/E%E2%88%92Hentai-Image-Viewing-Limits" target="_blank" style="color: #ffffff;">(See wiki)</a></i>, but may also cause some download problems.\
			</div>\
			<div class="g2">\
				+ Please pay attention to memory usage. I tested that the maximum accepted size is about (2GB - the memory used of this tab\'s process), and if browser cannot handle it, it will throw "Uncaught RangeError: Invalid array buffer length"\
			</div>\
			<!--<div class="g2">\
				*** <strong>This function is an experimental feature and may cause bug. </strong>Different browsers have different limit, See wiki for details.\
			</div>-->\
			<div style="text-align: center"><button>Save</button> <button>Cancel</button></div>';
	document.body.appendChild(ehDownloadSettingPanel);
	
	for (var i in setting) {
		var element = ehDownloadSettingPanel.querySelector('input[data-ehd-setting="' + i + '"]');
		if (!element) continue;
		if (element.getAttribute('type') === 'checkbox') ((setting[i]) && (element.setAttribute('checked', 'checked')));
		else element.setAttribute('value', setting[i]);
	}
	ehDownloadSettingPanel.addEventListener('click', function(event){
		if (event.target.tagName.toLowerCase() === 'button') {
			if (event.target.textContent === 'Save') {
				var inputs = ehDownloadSettingPanel.querySelectorAll('input[data-ehd-setting]');
				setting = {};
				for (var i = 0; i < inputs.length; i++) {
					if (inputs[i].getAttribute('type') !== 'checkbox' && inputs[i].value === '') continue;
					setting[inputs[i].dataset.ehdSetting] = inputs[i].getAttribute('type') === 'checkbox' ? inputs[i].checked : inputs[i].getAttribute('type') === 'number' ? Number(inputs[i].value) : inputs[i].value;
				}
				GM_setValue('ehD-setting', JSON.stringify(setting));
			}
			document.body.removeChild(ehDownloadSettingPanel);
		}
	});
}

// EHD Box, thanks to JingJang@GitHub, source: https://github.com/JingJang/E-Hentai-Downloader
var ehDownloadBox = document.createElement('fieldset');
ehDownloadBox.className = 'ehD-box';
ehDownloadBox.innerHTML = '<legend style="' + (origin === "http://exhentai.org" ? 'color: #ffff00; ' : '') + 'font-weight: 700;">E-Hentai Downloader</legend>\
	<style>' + ehDownloadStyle + '</style>';
// Use a lazy way to set stylesheet.

var ehDownloadArrow = '<img src="data:image/gif;base64,R0lGODlhBQAHALMAAK6vr7OztK+urra2tkJCQsDAwEZGRrKyskdHR0FBQUhISP///wAAAAAAAAAAAAAAACH5BAEAAAsALAAAAAAFAAcAAAQUUI1FlREVpbOUSkTgbZ0CUEhBLREAOw==">';

var ehDownloadAction = document.createElement('div');
ehDownloadAction.className = 'g2';
ehDownloadAction.innerHTML = ehDownloadArrow + ' <a>Download Archive</a>';
ehDownloadAction.addEventListener('click', function(event){
	event.preventDefault();
	if (isDownloading && !confirm('E-Hentai Downloader is working now, are you sure to stop downloading and start a new download?')) return;
	if (unsafeWindow.apiuid === -1 && !confirm('You are not log in to E-Hentai Forums, so you can\'t download original image. Continue?')) return;
	ehDownloadDialog.innerHTML = '';
	/*if (ehDownloadRange.querySelector('input').value.trim() === '') {
		if (pagesRange.length) pagesRange = [];
		initEHDownload();
	}
	else getAllPagesURL();*/

	initEHDownload();
});
ehDownloadBox.appendChild(ehDownloadAction);

var ehDownloadNumberInput = document.createElement('div');
ehDownloadNumberInput.className = 'g2';
ehDownloadNumberInput.innerHTML = ehDownloadArrow + ' <a><label><input type="checkbox" style="vertical-align: middle; margin: 0;"' + (needNumberImages ? ' checked="checked' : '') + '"> Number Images<label></a>';
ehDownloadBox.appendChild(ehDownloadNumberInput);

var ehDownloadRange = document.createElement('div');
ehDownloadRange.className = 'g2';
ehDownloadRange.innerHTML = ehDownloadArrow + ' <a><label>Pages Range <input type="text" placeholder="eg. 1-10,12,14-20,27,30"></label></a>';
ehDownloadBox.appendChild(ehDownloadRange);

var ehDownloadSetting = document.createElement('div');
ehDownloadSetting.className = 'g2';
ehDownloadSetting.innerHTML = ehDownloadArrow + ' <a>Settings</a>';
ehDownloadSetting.addEventListener('click', function(event){
	event.preventDefault();
	showSettings();
});
ehDownloadBox.appendChild(ehDownloadSetting);

var ehDownloadFeedback = document.createElement('div');
ehDownloadFeedback.className = 'g2';
ehDownloadFeedback.innerHTML = ehDownloadArrow + ' <a href="https://github.com/ccloli/E-Hentai-Downloader/issues" target="_blank">Feedback</a>';
ehDownloadBox.appendChild(ehDownloadFeedback);

document.body.insertBefore(ehDownloadBox, document.getElementById('asm') || document.querySelector('.gm').nextElementSibling);

var ehDownloadDialog = document.createElement('div');
ehDownloadDialog.className = 'ehD-dialog';
document.body.appendChild(ehDownloadDialog);

window.onbeforeunload = function(){
	ehDownloadFS.removeFile(unsafeWindow.gid + '.zip');
	if (isDownloading) return 'E-Hentai Downloader is still running, please don\'t close this tab before it finish downloading.';
};

// Forced request File System to check if have temp archive
if (setting['store-in-fs'] && window.requestFileSystem) window.requestFileSystem(window.TEMPORARY, 1024 * 1024 * 1024, ehDownloadFS.initCheckerHandler, ehDownloadFS.errorHandler);