import N3 from 'n3';
import {RdfXmlParser} from 'rdfxml-streaming-parser';

/**
 * parse a given RDF-string into a graph store
 * @param   {String}              content  RDF-compliant data
 * @returns {Promise.<N3.Store>}           N3-store with parsed data
 */
export async function parseRDF( content ) {

  try {

    // first attempt: N3 (Turtle, TriG, N-Triples, N-Quads, RDF* and Notation3 (N3))
    const result = await parseRDFN3( content );
    return result;

  } catch {
    try {

      // second attempt: RDF/XML
      const result = await parseRDFXML( content );
      return result;

    } catch {
      throw Exception( 'Unable to parse file content' );
    }
  }

}



/**
 * parse a given RDF-string into a graph store using N3 parser
 * @param   {String}              content  RDF-compliant data
 * @returns {Promise.<N3.Store>}           N3-store with parsed data
 */
function parseRDFN3( content ) {
  return new Promise( (resolve, reject) => {
    const parser = new N3.Parser();
    const store = new N3.Store();
    parser.parse( content,
                  (error, quad, prefixes) => {

                    // errors
                    if( error ) {
                      reject( error );
                    }

                    // content
                    if (quad) {
                      store.add( quad );
                    } else {
                      resolve( store );
                    }

                  });
  });
}



/**
 * parse a given RDF-string into a graph store using RDF/XML parser
 * @param   {String}              content  RDF-compliant data
 * @returns {Promise.<N3.Store>}           N3-store with parsed data
 */
function parseRDFXML( content ) {
  return new Promise( (resolve, reject) => {

    // store for result
    const store = new N3.Store();

    // setup parser
    const parser = new RdfXmlParser();
    parser
      .on( 'error', reject )
      .on( 'data', (quad) => store.add( quad ) )
      .on( 'end', () => resolve( store ) );

    // pipe content
    parser.write( content );
    parser.end();

  });
}
