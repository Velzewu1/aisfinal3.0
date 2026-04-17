.stiBookmarksPanel {
	z-index: 1;
	bottom: 0px;
	left: 0px;
	top: 0px;
	float: left;
	position: absolute;
	overflow: visible;
	white-space: nowrap;
	font-size: 12px;
	font-family: Arial;
}

.stiBookmarksContainer {
	top: 0px;
	left: 0px;
	right: 0px;
	bottom: 0px;
	z-index: 1;
	position: absolute;
	padding: 1px 0px 0px 2px;
	background: #f0f0f0;
	border: 1px solid gray;
	overflow: auto;
    font-family: Verdana, Geneva, Arial, Helvetica, sans-serif;
    font-size: 11px;
    color: #666;
    white-space: nowrap;
}

.stiBookmarksContainer img {	
    border: 0px;
    vertical-align: middle;
}

.stiBookmarksContainer a {
	color: #333;
	text-decoration: none;
	cursor: pointer;
}
 
.stiBookmarksContainer a.node,
.stiBookmarksContainer a.nodeSel 
{
	 white-space: nowrap;
	 padding: 1px 2px 1px 2px;
}

.stiBookmarksContainer a.node:hover,
.stiBookmarksContainer a.nodeSel:hover {
	color: #333;
	text-decoration: underline;
}

.stiBookmarksContainer a.nodeSel {
	background-color: #c0d2ec;
}

.stiBookmarksContainer a.clip {
	overflow: hidden;
}