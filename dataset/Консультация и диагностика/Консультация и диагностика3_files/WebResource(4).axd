// Node object
function stiTreeNode(id, pid, name, url, title) {
    this.id = id;
    this.pid = pid;
    this.name = name;
    this.url = url;
    this.title = title;
    this.page == null;
    if (title) this.page = parseInt(title.substr(5)) - 1;
    this.target = null;
    this.icon = null;
    this.iconOpen = null;
    this._io = false; // Open
    this._is = false;
    this._ls = false;
    this._hc = false;
    this._ai = 0;
    this._p;
}

// Tree object
function stiTree(objName, mvcViewerId, currentPageNumber) {
    this.config = {
        target: null,
        folderLinks: true,
        useSelection: true,
        useCookies: true,
        useLines: true,
        useIcons: true,
        useStatusText: false,
        closeSameLevel: false,
        inOrder: false
    }
    this.icon = {
        root: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAIQSURBVDhPpZNBaxNREMf7Lbz0ECq2RghEKBvN2pIEC5I8d9mSaiK1CVkaIl3jioJtbMoLpBCoizEoJicXoVFhhaDFqOhBKmhyi6CpF72EnjzkG/x9+6LFpS0IOczhze785jfzdkf6/T6GiZFhiu1aDuj1ejAMAw2z/F9R3CnuWXOA65iLJxpPy6j82sD9XQrjZw5r3Tzy3Ru43U3j+pdFpD6rmNua403+mnNA/UkdlFL+oLJbQOkHRbW0fGDErBmedwBGXaMDAwawO9PvOf6Srfpv2LnZTRF3VjUnwLIs6LoOkwHojq1+7VBA6JGItezCwTswqxQ5NvPK1yuHjiDWAtDmyf4dqKqKASCDq50M0u0k0ttRLLyXEH1FIL9QEKlLmK4EMU/OOAFj42M8YZYp23YKmXYCye0YKya40CQgDRlhK4IZ8yymDBHnpzxOQPN1E7F4jAPUdgrpj1Ek3hEodmdWTJ5JCG2GcKomQFifRMA7uPa9D8ntcfNDuUSx+CmOxAcFsTcylJeziDwnCNZD8D72Y+KhgJMFH3wTR5yAVqsFWZEZQEfybRjKVpgpSyBsZltbqPkw/kDA0Q0fPLcEhP0nnABJk/4Y6IjWRYTMaYjVIAKVAJvZj8l1AV7W2bMiwK159gM63zrcYHUpDiOv4V5BR/GmiuXMRSxdOofLxI/w6eN8eXZk72adBsP8kb8BkirtCGNnxv0AAAAASUVORK5CYII=',
        folder: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFLSURBVDhPrZTPRwVRFMenJJEUJZFERCKV+kv6J0pSRl6UlBIpEv3S5EnkTVESaYYhetFUatnubWc3i5llzOLb/c5r8a55ixNz+Syue+bj3HPOHSOOY+SBkYeEjvxFX9YkyOfpBD5OxvF+PIYoipAkiejqaUYU6MtTWw8v+8MIgkAkMyipuKZiqg4mnnYH4W0PwN3qx+NmHx42enG/1pNmW1tfg1f577pd6YLv+7qI9QAsRVGIhatCO1zX1UVvR6N/IspkXJqtcBxHF70ejFQFP4cyVOzFfEtWxM6komhHhoo9n2vOip73hqqiYF2Gii3ONmVFbG8qqhRkqNizmcasiDOSir4XZKhYa7oh2zUOVu2g3a1242a5E9dLHSgttoEdYnFZF16JEtu2US6X9a7xLfEZ8IAtlcBYfqNNNjeUMbMwDEXUe8y5/UZ+ASKCZCa2VAR9AAAAAElFTkSuQmCC',
        folderOpen: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAF0SURBVDhPtZQ9S8NQFIariIgfuDj4gYiCDk6K/gDBP+C/UKRIVbp0UJSA1MVBFFOKlGrj4iAUExFE4hAsCk5S0K1ky5BsilFe77mS1hs0iRAvvEO+nvO+59ybhOM4iEOJOCDE+B/QvTwN0t3BFCr7k7jdm4Bt23BdNzR+3REBvq839x2km51xmKYZCuOgBiTPWH4BV9ujuNwagSYN4XxzEOWNAZyt9XK3Xo85iKJ8rZ9A3j3BME4zPTAMQwRRP/h63Y0mVvAk3Q1N0xogI9eHv6imzwGWhKPlDqiqKoIAOSQWxZPxdJ3kRVGVUFhqCwAFRWNxXpwsB308pnCYbBVB1HlehVzZ2WChhEphGLXyLPKLLSKINlsdRFMz138XA1UvZvBQHENuoVkE0fgFV89pIECOmWGF+yHPN4lTI5DnqrTaBb+OVzpRTLXz5lJfKBK5URQFuq6L+4hgdAzoAY00iuhd+kbY2d4FRbQsK5L8hzm238gn6I5V7BwYvRoAAAAASUVORK5CYII=',
        node: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAF1SURBVDhPrdTdS8JQGAbw/ZPdBl1EVEhRRiF9UiBFlH3dFAQlkUWIFMwIIUUQKhKyG8UiBjOxMbZKXWvp094jUwl27MLBczE4/HjOu50j6LqObkToBkKGsH39Af/Jk2u88+fQNA2WZXGbC5sxDfTUajW22DRNGIaBcrmCnKSCoK3TTEdM2Lh8Q71eZ5jz0NuXBeSLBoN6jlUEgncMcxuFsH5RYG3+IpVvIFuoMshJKpVyh1bDL02EWlDUKlCqNJJ+BOJxYHw2gmg06g6thHL4sQs5QDuSV+3t2ckqwNh0mA/5DzKo2tv4NFtNJB2gOMhDCRjxnfGhpb1bV4QgQu5fAc9kiA8t7CSb82hv4iA3MkAZ9h7xobm1GIN4SFICBkcP+dDMsgj5vTUTpwltiZoQErc/7IBnnw/5FiPNwTpIuthAKIRcPQP9Q7t8aGIqiP+kty+ARCLh/h/JsswWiKLIDa2hta5HhA4qnSFFUbjpdAN07T76BbPQlITsTUS/AAAAAElFTkSuQmCC',
        empty: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAnSURBVDhPY/jw4cN/amAGahgCMmPUIMIRMhpGo2FEjfw2mo4IpyMAifXSOU7gtYMAAAAASUVORK5CYII=',
        line: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA1SURBVDhPY/jw4cN/XLihoQGnHLoeBnwGkSKH16BRF4EjZDSMcCdaWFobDaPRMCKl3MGlFgA7VcZpcEVwdwAAAABJRU5ErkJggg==',
        join: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA4SURBVDhPY/jw4cN/XLihoQGnHLoeBnwGkSKH16BRF4EjZIiGESz28NGj6Qh3foRlo9EwomMYAQDmB7/ZAUGKoQAAAABJRU5ErkJggg==',
        joinBottom: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA4SURBVDhPY/jw4cN/XLihoQGnHLoeBnwGkSKH16BRF4EjZIiGESz28NH0SUdUS5CjBhFOkEM7jADFMMUZr7aCxAAAAABJRU5ErkJggg==',
        plus: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABdSURBVDhPY/jw4cN/XLihoQGnHLoeBnwGkSKH16CBdxHIBYQwLu+ieI2QV/DJ4zWIgYEBJdYGziCQS9AxKGxgLsJGDxGvkZNlMLxGlXRESt4iKdMSSqDIhg3j3A8AzbaFufdkd2MAAAAASUVORK5CYII=',
        plusBottom: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABdSURBVDhPY/jw4cN/XLihoQGnHLoeBnwGkSKH16CBdxHIBYQwLu+ieI2QV/DJ4zWIgYEBJdYGziCQS9AxKGxgLsJGDxGvkZNlMLxGlXRESt4amExLigvpU4yQ4iIAvfSIWQuIrWcAAAAASUVORK5CYII=',
        minus: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABXSURBVDhPY/jw4cN/XLihoQGnHLoeBnwGkSKH16CBdxHIBYQwLu+ieI2QV/DJDxGDGBgY/qNjUNjAvIaNHiJeIyfLYHiNKumIlLxFUqZtamoazf0f/gMAmKuQ/5bqBokAAAAASUVORK5CYII=',
        minusBottom: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABXSURBVDhPY/jw4cN/XLihoQGnHLoeBnwGkSKH16CBdxHIBYQwLu+ieI2QV/DJDxGDGBgY/qNjUNjAvIaNHiJeIyfLYHiNKumIlLw1MJmWFBfSpxghxUUAgsWTmbR+l/cAAAAASUVORK5CYII=',
        nlPlus: 'img/nolines_plus.gif',
        nlMinus: 'img/nolines_minus.gif'
    };
    this.obj = objName;
    this.mvcViewerId = mvcViewerId;
    this.currentPageNumber = currentPageNumber;
    this.aNodes = [];
    this.aIndent = [];
    this.root = new stiTreeNode(-1);
    this.selectedNode = null;
    this.selectedFound = false;
    this.completed = false;
}

// Adds a new node to the node array
stiTree.prototype.add = function (id, pid, name, url, title, page) {
    this.aNodes[this.aNodes.length] = new stiTreeNode(id, pid, name, url, title, page);
}

// Open/close all nodes
stiTree.prototype.openAll = function () {
    this.oAll(true);
}

stiTree.prototype.closeAll = function () {
    this.oAll(false);
}

// Outputs the tree to the page
stiTree.prototype.toString = function () {
    var str = '<div class="stiTree">\n';
    if (document.getElementById) {
        if (this.config.useCookies) this.selectedNode = this.getSelected();
        str += this.addNode(this.root);
    } else str += 'Browser not supported.';
    str += '</div>';
    if (!this.selectedFound) this.selectedNode = null;
    this.completed = true;
    return str;
}

// Creates the tree structure
stiTree.prototype.addNode = function (pNode) {
    var str = '';
    var n = 0;
    if (this.config.inOrder) n = pNode._ai;
    for (n; n < this.aNodes.length; n++) {
        if (this.aNodes[n].pid == pNode.id) {
            var cn = this.aNodes[n];
            cn._p = pNode;
            cn._ai = n;
            this.setCS(cn);
            if (!cn.target && this.config.target) cn.target = this.config.target;
            if (cn._hc && !cn._io && this.config.useCookies) cn._io = this.isOpen(cn.id);
            if (!this.config.folderLinks && cn._hc) cn.url = null;
            if (this.config.useSelection && cn.id == this.selectedNode && !this.selectedFound) {
                cn._is = true;
                this.selectedNode = n;
                this.selectedFound = true;
            }
            str += this.node(cn, n);
            if (cn._ls) break;
        }
    }
    return str;
}

// Creates the node icon, url and text
stiTree.prototype.node = function (node, nodeId) {
    var str = '<div class="stiTreeNode">' + this.indent(node, nodeId);
    if (this.config.useIcons) {
        if (!node.icon) node.icon = (this.root.id == node.pid) ? this.icon.root : ((node._hc) ? this.icon.folder : this.icon.node);
        if (!node.iconOpen) node.iconOpen = (node._hc) ? this.icon.folderOpen : this.icon.node;
        if (this.root.id == node.pid) {
            node.icon = this.icon.root;
            node.iconOpen = this.icon.root;
        }
        str += '<img id="i' + this.obj + nodeId + '" src="' + ((node._io) ? node.iconOpen : node.icon) + '" alt="" />';
    }
    if (node.url) {
        //str += '<a id="s' + this.obj + nodeId + '" class="' + ((this.config.useSelection) ? ((node._is ? 'nodeSel' : 'node')) : 'node') + '" href="' + node.url + '"';
        str += '<a id="s' + this.obj + nodeId + '" class="' + ((this.config.useSelection) ? ((node._is ? 'nodeSel' : 'node')) : 'node') + '"';
        if (node.title) str += ' title="' + node.title + '"';
        if (node.target) str += ' target="' + node.target + '"';
        if (this.config.useStatusText) str += ' onmouseover="window.status=\'' + node.name + '\';return true;" onmouseout="window.status=\'\';return true;" ';

        var clc = "";
        if (this.config.useSelection && ((node._hc && this.config.folderLinks) || !node._hc)) clc += this.obj + ".s(" + nodeId + ");";
        if (node.page != null) clc += "js" + this.mvcViewerId + ".postAction('BookmarkAction'," + node.page + ",'" + node.url.substr(1) + "');";
        if (clc.length > 0) str += ' onclick="' + clc + '"';

        str += '>';
    }
    else if ((!this.config.folderLinks || !node.url) && node._hc && node.pid != this.root.id)
        str += '<a href="javascript: ' + this.obj + '.o(' + nodeId + ');" class="node">';
    str += node.name;
    if (node.url || ((!this.config.folderLinks || !node.url) && node._hc)) str += '</a>';
    str += '</div>';
    if (node._hc) {
        str += '<div id="d' + this.obj + nodeId + '" class="clip" style="display:' + ((this.root.id == node.pid || node._io) ? 'block' : 'none') + ';">';
        str += this.addNode(node);
        str += '</div>';
    }
    this.aIndent.pop();
    return str;
}

// Adds the empty and line icons
stiTree.prototype.indent = function (node, nodeId) {
    var str = '';
    if (this.root.id != node.pid) {
        for (var n = 0; n < this.aIndent.length; n++)
            str += '<img src="' + ((this.aIndent[n] == 1 && this.config.useLines) ? this.icon.line : this.icon.empty) + '" alt="" />';
        (node._ls) ? this.aIndent.push(0) : this.aIndent.push(1);
        if (node._hc) {
            str += '<a href="javascript: ' + this.obj + '.o(' + nodeId + ');"><img id="j' + this.obj + nodeId + '" src="';
            if (!this.config.useLines) str += (node._io) ? this.icon.nlMinus : this.icon.nlPlus;
            else str += ((node._io) ? ((node._ls && this.config.useLines) ? this.icon.minusBottom : this.icon.minus) : ((node._ls && this.config.useLines) ? this.icon.plusBottom : this.icon.plus));
            str += '" alt="" /></a>';
        } else str += '<img src="' + ((this.config.useLines) ? ((node._ls) ? this.icon.joinBottom : this.icon.join) : this.icon.empty) + '" alt="" />';
    }
    return str;
}

// Checks if a node has any children and if it is the last sibling
stiTree.prototype.setCS = function (node) {
    var lastId;
    for (var n = 0; n < this.aNodes.length; n++) {
        if (this.aNodes[n].pid == node.id) node._hc = true;
        if (this.aNodes[n].pid == node.pid) lastId = this.aNodes[n].id;
    }
    if (lastId == node.id) node._ls = true;
}

// Returns the selected node
stiTree.prototype.getSelected = function () {
    var sn = this.getCookie('cs' + this.obj);
    return (sn) ? sn : null;
}

// Highlights the selected node
stiTree.prototype.s = function (id) {
    if (!this.config.useSelection) return;
    var cn = this.aNodes[id];
    if (cn._hc && !this.config.folderLinks) return;
    if (this.selectedNode != id) {
        if (this.selectedNode || this.selectedNode == 0) {
            eOld = document.getElementById("s" + this.obj + this.selectedNode);
            eOld.className = "node";
        }
        eNew = document.getElementById("s" + this.obj + id);
        eNew.className = "nodeSel";
        this.selectedNode = id;
        if (this.config.useCookies) this.setCookie('cs' + this.obj, cn.id);
    }
}

// Toggle Open or close
stiTree.prototype.o = function (id) {
    var cn = this.aNodes[id];
    this.nodeStatus(!cn._io, id, cn._ls);
    cn._io = !cn._io;
    if (this.config.closeSameLevel) this.closeLevel(cn);
    if (this.config.useCookies) this.updateCookie();
}

// Open or close all nodes
stiTree.prototype.oAll = function (status) {
    for (var n = 0; n < this.aNodes.length; n++) {
        if (this.aNodes[n]._hc && this.aNodes[n].pid != this.root.id) {
            this.nodeStatus(status, n, this.aNodes[n]._ls)
            this.aNodes[n]._io = status;
        }
    }
    if (this.config.useCookies) this.updateCookie();
}

// Opens the tree to a specific node
stiTree.prototype.openTo = function (nId, bSelect, bFirst) {
    if (!bFirst) {
        for (var n = 0; n < this.aNodes.length; n++) {
            if (this.aNodes[n].id == nId) {
                nId = n;
                break;
            }
        }
    }
    var cn = this.aNodes[nId];
    if (cn.pid == this.root.id || !cn._p) return;
    cn._io = true;
    cn._is = bSelect;
    if (this.completed && cn._hc) this.nodeStatus(true, cn._ai, cn._ls);
    if (this.completed && bSelect) this.s(cn._ai);
    else if (bSelect) this._sn = cn._ai;
    this.openTo(cn._p._ai, false, true);
}

// Closes all nodes on the same level as certain node
stiTree.prototype.closeLevel = function (node) {
    for (var n = 0; n < this.aNodes.length; n++) {
        if (this.aNodes[n].pid == node.pid && this.aNodes[n].id != node.id && this.aNodes[n]._hc) {
            this.nodeStatus(false, n, this.aNodes[n]._ls);
            this.aNodes[n]._io = false;
            this.closeAllChildren(this.aNodes[n]);
        }
    }
}

// Closes all children of a node
stiTree.prototype.closeAllChildren = function (node) {
    for (var n = 0; n < this.aNodes.length; n++) {
        if (this.aNodes[n].pid == node.id && this.aNodes[n]._hc) {
            if (this.aNodes[n]._io) this.nodeStatus(false, n, this.aNodes[n]._ls);
            this.aNodes[n]._io = false;
            this.closeAllChildren(this.aNodes[n]);
        }
    }
}

// Change the status of a node(open or closed)
stiTree.prototype.nodeStatus = function (status, id, bottom) {
    eDiv = document.getElementById('d' + this.obj + id);
    eJoin = document.getElementById('j' + this.obj + id);
    if (this.config.useIcons) {
        eIcon = document.getElementById('i' + this.obj + id);
        eIcon.src = (status) ? this.aNodes[id].iconOpen : this.aNodes[id].icon;
    }
    eJoin.src = (this.config.useLines) ?
	((status) ? ((bottom) ? this.icon.minusBottom : this.icon.minus) : ((bottom) ? this.icon.plusBottom : this.icon.plus)) :
	((status) ? this.icon.nlMinus : this.icon.nlPlus);
    eDiv.style.display = (status) ? 'block' : 'none';
}

// [Cookie] Clears a cookie
stiTree.prototype.clearCookie = function () {
    var now = new Date();
    var yesterday = new Date(now.getTime() - 1000 * 60 * 60 * 24);
    this.setCookie('co' + this.obj, 'cookieValue', yesterday);
    this.setCookie('cs' + this.obj, 'cookieValue', yesterday);
}

// [Cookie] Sets value in a cookie
stiTree.prototype.setCookie = function (cookieName, cookieValue, expires, path, domain, secure) {
    document.cookie =
		escape(cookieName) + '=' + escape(cookieValue)
		+ (expires ? '; expires=' + expires.toGMTString() : '')
		+ (path ? '; path=' + path : '')
		+ (domain ? '; domain=' + domain : '')
		+ (secure ? '; secure' : '');
}

// [Cookie] Gets a value from a cookie
stiTree.prototype.getCookie = function (cookieName) {
    var cookieValue = '';
    var posName = document.cookie.indexOf(escape(cookieName) + '=');
    if (posName != -1) {
        var posValue = posName + (escape(cookieName) + '=').length;
        var endPos = document.cookie.indexOf(';', posValue);
        if (endPos != -1) cookieValue = unescape(document.cookie.substring(posValue, endPos));
        else cookieValue = unescape(document.cookie.substring(posValue));
    }
    return (cookieValue);
}

// [Cookie] Returns ids of open nodes as a string
stiTree.prototype.updateCookie = function () {
    var str = '';
    for (var n = 0; n < this.aNodes.length; n++) {
        if (this.aNodes[n]._io && this.aNodes[n].pid != this.root.id) {
            if (str) str += '.';
            str += this.aNodes[n].id;
        }
    }
    this.setCookie('co' + this.obj, str);
}

// [Cookie] Checks if a node id is in a cookie
stiTree.prototype.isOpen = function (id) {
    var aOpen = this.getCookie('co' + this.obj).split('.');
    for (var n = 0; n < aOpen.length; n++)
        if (aOpen[n] == id) return true;
    return false;
}

// If Push and pop is not implemented by the browser
if (!Array.prototype.push) {
    Array.prototype.push = function array_push() {
        for (var i = 0; i < arguments.length; i++)
            this[this.length] = arguments[i];
        return this.length;
    }
}

if (!Array.prototype.pop) {
    Array.prototype.pop = function array_pop() {
        lastElement = this[this.length - 1];
        this.length = Math.max(this.length - 1, 0);
        return lastElement;
    }
}