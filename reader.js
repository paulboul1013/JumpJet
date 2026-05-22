//reader class 

function Reader(str) {
    this.data = str;
    this.curr_pos = 0;
    this.data_length = str.length;
}

Reader.prototype.nextChar = function () {
    if (this.curr_pos >= this.data_length) {
        return -1; //end of string stream
    }

    return this.data[this.curr_pos++];
}

//back n characters
Reader.prototype.retract = function (n) {
    if (n == undefined) {
        n = 1;
    }

    this.curr_pos -= n;

    if (this.curr_pos < 0) {
        this.curr_pos = 0;
    }
}


function log(str) {
    $("#log").append(str + "<br />");
}

$(function () {
    //stored in <script id="jj">
    var data_to_compiled = $("#jj").text();
    var reader = new Reader(data_to_compiled);
    var retracted = false;

    while (true) {
        var next_char = reader.nextChar();
        if (next_char == -1) {
            break;
        }


        //if meets '!' token , will retract once
        if (next_char == "!" && !retracted) {
            reader.retract();
            retracted = true;
        }
        log("char: " + next_char);
    }
});

//Token class
//type : Token type
//text:  actual text make this token
function Token(type, text) {
    this.type = type;
    this.text = text;
}

Token.tokens = {}
Token.tokens.EOS_TOKEN = 1; //end of stream

//adding a new token by plus 1 easily
Token.tokens.COLON_TOKEN = Token.tokens.EOS_TOKEN + 1;
Token.tokens.SEMICOLON_TOKEN = Token.tokens.COLON_TOKEN + 1;
Token.tokens.LEFTPAREN_TOKEN = Token.tokens.SEMICOLON_TOKEN + 1;
Token.tokens.RIGHTPAREN_TOKEN = Token.tokens.LEFTPAREN_TOKEN + 1;
Token.tokens.LEFTBRACE_TOKEN = Token.tokens.RIGHTPAREN_TOKEN + 1;
Token.tokens.RIGHTBRACE_TOKEN = Token.tokens.LEFTBRACE_TOKEN + 1;
Token.tokens.MOD_TOKEN = Token.tokens.RIGHTBRACE_TOKEN + 1;
Token.backwardmap = {}; //for inverse look-up


for (var x in Token.tokens) {
    Token.backwardmap[Token.tokens[x]] = x;
}