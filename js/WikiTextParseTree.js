/*\
title: js/WikiTextParseTree.js

A container for the parse tree generated by parsing wikitext

\*/
(function(){

/*jslint node: true */
"use strict";

var ArgParser = require("./ArgParser.js").ArgParser,
	utils = require("./Utils.js");

// Intialise the parse tree object
var WikiTextParseTree = function(tree,dependencies,store) {
	this.tree = tree;
	this.dependencies = dependencies; // An array of tiddler names, or null if this tiddler depends on too many to track
	this.store = store;
};

// Compile the parse tree into a JavaScript function that returns the required
// representation of the tree
WikiTextParseTree.prototype.compile = function(type,treenode) {
	treenode = treenode || this.tree;
	var output = [];
	if(type === "text/html") {
		this.compileSubTreeHtml(output,treenode);
	} else if(type === "text/plain") {
		this.compileSubTreePlain(output,treenode);
	} else {
		return null;
	}
	// And then wrap the javascript tree and render it back into JavaScript code
	var parseTree = this.store.jsParser.createTree(
		[
			{
				type: "Function",
				name: null,
				params: ["tiddler","store","utils"], // These are the parameters passed to the tiddler function; must match the invocation in WikiStore.renderTiddler()
				elements: [
					{
					type: "ReturnStatement",
					value: {
						type: "FunctionCall",
						name: {
							type: "PropertyAccess",
							base: {
								type: "ArrayLiteral",
								elements: output
							},
							name: "join"
						},
						"arguments": [ {
							type: "StringLiteral",
							value: ""
							}
						]
						}
					}
				]
			}
		]);
	var r = parseTree.render();
	return r;
};

WikiTextParseTree.prototype.pushString = function(output,s) {
	var last = output[output.length-1];
	if(output.length > 0 && last.type === "StringLiterals") {
		last.value.push(s);
	} else if (output.length > 0 && last.type === "StringLiteral") {
		last.type = "StringLiterals";
		last.value = [last.value,s];
	} else {
		output.push({type: "StringLiteral", value: s});
	}
};

WikiTextParseTree.prototype.compileMacroCall = function(output,type,node) {
	var name = node.name,
		params = node.params,
		macro = this.store.macros[name],
		p,
		n;
	if(!macro) {
		this.pushString(output,"{{** Unknown macro '" + name + "' **}}");
		return;
	}
	if(macro.types.indexOf(type) === -1) {
		this.pushString(output,"{{**  Macro '" + name + "' cannot render to MIME type '" + type + "'**}}");
		return;
	}
	var macroCall = {
		type: "FunctionCall",
		name: {
			base: {
				base: {
					base: {
						name: "store", 
						type: "Variable"}, 
					name: "macros", 
					type: "PropertyAccess"}, 
				name: {
					type: "StringLiteral", 
					value: name}, 
				type: "PropertyAccess"}, 
			name: "handler", 
			type: "PropertyAccess"},
		"arguments": [ {
			type: "StringLiteral", 
			value: type
		},{
			type: "Variable",
			name: "tiddler"
		},{
			type: "Variable",
			name: "store"
		},{
			type: "ObjectLiteral",
			properties: []	
		}]
	};
	for(p in params) {
		if(params[p].type === "string") {
			n = {type: "StringLiteral", value: params[p].value};
		} else {
			n = this.store.jsParser.parse(params[p].value).tree.elements[0];
		}
		macroCall["arguments"][3].properties.push({
			type: "PropertyAssignment",
			name: p,
			value: n
		});
	}
	if(node.children) {
		var subOutput = [];
		this.compileSubTreeHtml(subOutput,node.children);
		macroCall["arguments"].push({
			type: "FunctionCall",
			name: {
				type: "PropertyAccess",
				base: {
					type: "ArrayLiteral",
					elements: subOutput
				},
				name: "join"
			},
			"arguments": [ {
				type: "StringLiteral",
				value: ""
			}]
		});
	}
	var wrapperTag = macro.wrapperTag || "div";
	if(type === "text/html") {
		this.pushString(output,utils.stitchElement(wrapperTag,{
			"data-tw-macro": name
		}));
	}
	output.push(macroCall);
	if(type === "text/html") {
		this.pushString(output,"</" + wrapperTag + ">");
	}
};

WikiTextParseTree.prototype.compileElementHtml = function(output,element,options) {
	options = options || {};
	var tagBits = [element.type];
	if(element.attributes) {
		for(var a in element.attributes) {
			var r = element.attributes[a];
			if(a === "style") {
				var s = [];
				for(var t in r) {
					s.push(t + ":" + r[t] + ";");
				}
				r = s.join("");
			}
			tagBits.push(a + "=\"" + utils.htmlEncode(r) + "\"");
		}
	}
	this.pushString(output,"<" + tagBits.join(" ") + (options.selfClosing ? " /" : "") + ">");
	if(!options.selfClosing) {
		if(element.children) {
			this.compileSubTreeHtml(output,element.children);
		}
		this.pushString(output,"</" + element.type + ">");
	}
};

WikiTextParseTree.prototype.compileSubTreeHtml = function(output,tree) {
	for(var t=0; t<tree.length; t++) {
		switch(tree[t].type) {
			case "text":
				this.pushString(output,utils.htmlEncode(tree[t].value));
				break;
			case "entity":
				this.pushString(output,tree[t].value);
				break;
			case "br":
			case "img":
				this.compileElementHtml(output,tree[t],{selfClosing: true}); // Self closing elements
				break;
			case "macro":
				this.compileMacroCall(output,"text/html",tree[t]);
				break;
			default:
				this.compileElementHtml(output,tree[t]);
				break;
		}
	}
};

WikiTextParseTree.prototype.compileElementPlain = function(output,element, options) {
	options = options || {};
	if(!options.selfClosing) {
		if(element.children) {
			this.compileSubTreePlain(output,element.children);
		}
	}
};

WikiTextParseTree.prototype.compileSubTreePlain = function(output,tree) {
	for(var t=0; t<tree.length; t++) {
		switch(tree[t].type) {
			case "text":
				this.pushString(output,utils.htmlEncode(tree[t].value));
				break;
			case "entity":
				var c = utils.entityDecode(tree[t].value);
				if(c) {
					this.pushString(output,c);
				} else {
					this.pushString(output,tree[t].value);
				}
				break;
			case "br":
			case "img":
				this.compileElementPlain(output,tree[t],{selfClosing: true}); // Self closing elements
				break;
			case "macro":
				this.compileMacroCall(output,"text/plain",tree[t]);
				break;
			default:
				this.compileElementPlain(output,tree[t]);
				break;
		}
	}
};

exports.WikiTextParseTree = WikiTextParseTree;

})();
