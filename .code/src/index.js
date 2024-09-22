
import { QueryEngine } from '@comunica/query-sparql-rdfjs';
import Mustache from 'mustache';
import { promises as Fs } from 'node:fs';
import Path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRDF } from './util/parse.js';


// important paths
// https://stackoverflow.com/a/55944697/1169798
const PATH_ROOT = Path.resolve( Path.dirname( fileURLToPath(import.meta.url) ), '..', '..' );
const PATH_DIST = Path.join( PATH_ROOT, 'dist' );
const PATH_TMPL = Path.join( PATH_ROOT, '.code', 'templates' );
try{
  await Fs.access( PATH_DIST );
  await Fs.rm( PATH_DIST, {recursive: true } );
} catch {}
await Fs.mkdir( PATH_DIST );

// common namespaces
const NS = {
  iop:  'https://w3id.org/iadopt/ont/',
  rdf:  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
};
// properties
const PROP_MAP = {
  label:      [ NS.rdfs + 'label', NS.skos + 'prefLabel' ],
  comment:    [ NS.rdfs + 'comment', NS.rdfs + 'description', NS.skos + 'definition' ],
};


/* XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX SCAN XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX */

// results of scanning phase
const data = [];

// initialize SPARQL engine
const engine = new QueryEngine();

// scan for RDF files
for await(const rawFilePath of Fs.glob( '**/*.ttl', { cwd: PATH_ROOT} ) ) {

  // skip templates
  if( rawFilePath.includes( 'template') ) {
    continue;
  }

  // parse
  const raw = await Fs.readFile( Path.join( PATH_ROOT, rawFilePath ), 'utf8' );
  const store = await parseRDF( raw );

  // prepare container for infos
  const pathComponents = rawFilePath.split( Path.sep );
  const entry = {
    file: pathComponents.pop(),
    path: pathComponents,
    context: [],
  };

  // mandatory data
  let bindings = await engine.queryBindings(`
    PREFIX iop: <${NS.iop}>

    SELECT DISTINCT
      ?variable ?ooi ?prop
      ?variableLabel ?variableComment
      ?ooiLabel ?ooiComment
      ?propLabel ?propComment
    WHERE {
      VALUES ?labelProp { ${PROP_MAP.label.map( (el) => `<${el}>` ).join( ' ' )} }
      VALUES ?commentProp { ${PROP_MAP.comment.map( (el) => `<${el}>` ).join( ' ' )} }

      ?variable a iop:Variable ;
                iop:hasObjectOfInterest  ?ooi ;
                iop:hasProperty          ?prop .
      OPTIONAL { ?variable  ?labelProp    ?variableLabel .    FILTER(LANG(?variableLabel) = ""    || LANGMATCHES(LANG(?variableLabel), "en") ) }
      OPTIONAL { ?variable  ?commentProp  ?variableComment .  FILTER(LANG(?variableComment) = ""  || LANGMATCHES(LANG(?variableComment), "en") ) }
      OPTIONAL { ?ooi       ?labelProp    ?ooiLabel .         FILTER(LANG(?ooiLabel) = ""         || LANGMATCHES(LANG(?ooiLabel), "en") ) }
      OPTIONAL { ?ooi       ?commentProp  ?ooiComment .       FILTER(LANG(?ooiComment) = ""       || LANGMATCHES(LANG(?ooiComment), "en") ) }
      OPTIONAL { ?prop      ?labelProp    ?propLabel .        FILTER(LANG(?propLabel) = ""        || LANGMATCHES(LANG(?propLabel), "en") ) }
      OPTIONAL { ?prop      ?commentProp  ?propComment .      FILTER(LANG(?propComment) = ""      || LANGMATCHES(LANG(?propComment), "en") ) }
    }`, { sources: [store] });
  for await (const binding of bindings) {
    entry.variable = {
      url:      binding.get( 'variable' )?.value,
      label:    binding.get( 'variableLabel' )?.value,
      comment:  binding.get( 'variableComment' )?.value,
    };
    entry.ooi = {
      url:      binding.get( 'ooi' )?.value,
      label:    binding.get( 'ooiLabel' )?.value,
      comment:  binding.get( 'ooiComment' )?.value,
    };
    entry.prop = {
      url:      binding.get( 'prop' )?.value,
      label:    binding.get( 'propLabel' )?.value,
      comment:  binding.get( 'propComment' )?.value,
    };
  }

  // invalid file - no variable
  if( !('variable' in entry) ) {
    console.warn( `File "${rawFilePath}" does not contain a valid iop:Variable!` );
    continue;
  }

  // optional: Matrix & ContextObject
  bindings = await engine.queryBindings(`
    PREFIX iop: <${NS.iop}>

    SELECT DISTINCT
      ?prop ?value ?label ?comment
    WHERE {
      VALUES ?prop { iop:hasContextObject iop:hasMatrix }
      VALUES ?labelProp   { ${PROP_MAP.label.map( (el) => `<${el}>` ).join( ' ' )} }
      VALUES ?commentProp { ${PROP_MAP.comment.map( (el) => `<${el}>` ).join( ' ' )} }

      <${entry.variable.url}> ?prop ?value .
      OPTIONAL{ ?value ?labelProp     ?label .    FILTER(LANG(?label) = ""   || LANGMATCHES(LANG(?label), "en") ) }
      OPTIONAL{ ?value ?commentProp   ?comment .  FILTER(LANG(?comment) = "" || LANGMATCHES(LANG(?comment), "en") ) }
    }`, { sources: [store] });
  for await (const binding of bindings) {

    if( binding.get( 'prop' ).value == NS.iop + 'hasMatrix' ) {

      entry.matrix = {
        url:      binding.get( 'value' )?.value,
        label:    binding.get( 'label' )?.value,
        comment:  binding.get( 'comment' )?.value,
      };

    } else {

      entry.contextLookup = entry.contextLookup || {};
      const url = binding.get( 'value' )?.value;
      entry.contextLookup[ url ] = entry.contextLookup[ url ] || {};
      entry.contextLookup[ url ].url     = entry.contextLookup[ url ].url     || binding.get( 'value' )?.value;
      entry.contextLookup[ url ].label   = entry.contextLookup[ url ].label   || binding.get( 'label' )?.value;
      entry.contextLookup[ url ].comment = entry.contextLookup[ url ].comment || binding.get( 'comment' )?.value;

    }
  }
  if( entry.contextLookup ) {
    entry.context = Object.values( entry.contextLookup );
  }

  // optional: constraints
  bindings = await engine.queryBindings(`
    PREFIX iop: <${NS.iop}>

    SELECT DISTINCT
      ?constraint ?label ?comment ?target
    WHERE {
      VALUES ?labelProp   { ${PROP_MAP.label.map( (el) => `<${el}>` ).join( ' ' )} }
      VALUES ?commentProp { ${PROP_MAP.comment.map( (el) => `<${el}>` ).join( ' ' )} }

      <${entry.variable.url}> iop:hasConstraint ?constraint .
      OPTIONAL{ ?constraint iop:constrains ?target . }
      OPTIONAL{ ?constraint ?labelProp     ?label .    FILTER(LANG(?label) = ""   || LANGMATCHES(LANG(?label), "en") ) }
      OPTIONAL{ ?constraint ?commentProp   ?comment .  FILTER(LANG(?comment) = "" || LANGMATCHES(LANG(?comment), "en") ) }
    }`, { sources: [store] });
  entry.constraints = [];
  for await (const binding of bindings) {
    entry.constraintLookup = entry.constraintLookup || {};
    const url = binding.get( 'constraint' )?.value;
    entry.constraintLookup[ url ] = entry.constraintLookup[ url ] || {};
    entry.constraintLookup[ url ].url     = entry.constraintLookup[ url ].url     || binding.get( 'constraint' )?.value;
    entry.constraintLookup[ url ].label   = entry.constraintLookup[ url ].label   || binding.get( 'label' )?.value;
    entry.constraintLookup[ url ].comment = entry.constraintLookup[ url ].comment || binding.get( 'comment' )?.value;
    entry.constraintLookup[ url ].target  = entry.constraintLookup[ url ].target  || binding.get( 'target' )?.value;
  }
  if( entry.constraintLookup ) {
    entry.constraints = Object.values( entry.constraintLookup );
  }

  // add to result if valid entry
  data.push( entry );

}


/* XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX PUBLISH XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX */

// reformat data
const renderView = { sections: [] };
const lookup = {};
for( const entry of data ) {

  // make sure the respective section exists
  const path = entry.path.join( Path.sep );
  if( !(path in lookup) ) {
    lookup[ path ] = {
      folder: path,
      entries: [],
    };
    renderView.sections.push( lookup[ path ] );
  }

  // add variable
  entry.details  = Path.join( ... entry.path, entry.file + '.html' );
  entry.download = entry.path.join( '/' ) + '/' + entry.file;
  lookup[ path ].entries.push( entry );

}

// sort entries
renderView.sections.sort( (a,b) => a.folder.localeCompare( b.folder ) );
renderView.sections.forEach( (section) => section.entries.sort( (a,b) => a.variable.label.localeCompare( b.variable.label ) ) );


// overview
let template = await Fs.readFile( Path.join( PATH_TMPL, 'index.mustache' ), 'utf8' );
let rendered = Mustache.render( template, renderView );
await Fs.writeFile( Path.join( PATH_DIST, 'index.html' ), rendered );

// render details document for each file
template = await Fs.readFile( Path.join( PATH_TMPL, 'details.mustache' ), 'utf8' );
for( const entry of data ) {

  // fill up labels, where needed
  const entities = [ entry.ooi, entry.prop, entry.matrix, ... (entry.context || []), ... (entry.constraints || []) ]
    .filter( (e) => e )
    .reduce( (all, e) => {
      all[ e.url ] = e;
      return all;
    }, {} );
  for( const ent of Object.values( entities ) ) {
    if( !ent.label ) {
      const fragments = ent.url.split( '/' );
      ent.label = fragments.pop() || fragments.pop() || '[missing label]';
    }

  }

  // assign constraints
  entry.constraints = entry.constraints.filter( (cons) => {

    if( cons.target in entities ) {

      // attach to the corresponding target
      entities[ cons.target ].constrained = entities[ cons.target ].constrained || [];
      entities[ cons.target ].constrained.push( cons );

      // remove from list of "unassigned constraints"
      return false;
    }

    // leave as "unassigned constraints"
    return true;

  });

  // render
  rendered = Mustache.render( template, entry );

  // write to file
  const folder = Path.join( PATH_DIST, ... entry.path );
  try{
    await Fs.access( folder );
  } catch {
    await Fs.mkdir( folder );
  }
  const path =  Path.join( folder, entry.file + '.html' );
  await Fs.writeFile( path, rendered );
  console.log( `written ${path}` );

}

// copy files
for await(const filePath of Fs.glob( '**/!(*.mustache)', { cwd: PATH_TMPL } ) ) {
  const target = Path.join( PATH_DIST, filePath );
  try {
    await Fs.access( Path.dirname(target) );
  } catch {
    await Fs.mkdir( Path.dirname( target ) );
  }
  await Fs.copyFile(
    Path.join( PATH_TMPL, filePath ),
    target
  );
}

for( const entry of data ) {
  await Fs.copyFile(
    Path.join( PATH_ROOT, ... entry.path, entry.file ),
    Path.join( PATH_DIST, ... entry.path, entry.file ),
  );
}