.stiMainPanel {
	overflow: visible;
	width: 100%;
    height: 100%;
    z-index: 2;
    position: relative;
}

.stiMainPanel table,
.stiMainPanel td {
	margin-top: 0;
}

.stiReportPanel {
	z-index: 1;
	bottom: 0px;
	right: 0px;
	left: 0px;
}

.stiReportPanel table,
.stiReportPanel td {
	padding: 0px;
}

.stiPageControl,
.stiPageControl td {
	padding: 0px;
	border: 0px;
}

.stiProcessImage {
	z-index: 10;
	position: absolute;
}

.stiDisabledPanel {
	top: 0px;
	left: 0px;
	right: 0px;
	bottom: 0px;
	z-index: 9;
	position: absolute;
	background: white;
	filter: alpha(Opacity=10);
    opacity: 0.1;
    -moz-opacity: 0.1;
    -khtml-opacity: 0.1;
}

.stiToolTip {    
    position: absolute;
	border:1px solid #b4b4b4;
	background: #ffffff;	
    cursor: default;
    -moz-user-select: none;
    -khtml-user-select: none;
    -webkit-user-select: none;    
    z-index: 10;
    max-width: 250px;
    -moz-box-shadow: 0px 0px 7px rgba(0,0,0,0.6);
    -webkit-box-shadow: 0px 0px 7px rgba(0,0,0,0.6);
    box-shadow: 0 0 7px rgba(0,0,0,0.3);    
}

.stiToolTipImage {
	width: 16px;
	height: 16px;
	background: url('[HelpIcon.gif]');
}

.stiToolTipTextCell {    
    font-size: 12px;
    font-family: Arial;
	color: #444444;
	padding: 10px;
	border: 0px;
	border-bottom:1px solid #b4b4b4;
	white-space: normal;	
}

.stiToolTipButtonOver {
    color: #0000ff;
    cursor: pointer;
    font-family: Arial;
    font-size: 12px;
    border: 0px;
    padding: 0px;
}

.stiToolTipButton {
    color: #000000;
    cursor: default;
    font-family: Arial;
    font-size: 12px;
    border: 0px;
    padding: 0px;
}

.stiOverrideGloobalMvcStyles
{
	border: 0px;
	padding: 0px;
}