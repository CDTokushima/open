function appendScript(URL) {
	var el = document.createElement('script');
	el.src = URL;
	document.body.appendChild(el);
};

appendScript("https://cdnjs.cloudflare.com/ajax/libs/p5.js/0.9.0/p5.min.js");
appendScript("https://unpkg.com/ml5@0.4.1/dist/ml5.min.js");

let word2Vec;

function modelLoaded() {
	console.log('Model Loaded');
}

function setup() {
  // Create the Word2Vec model with pre-trained file of 10,000 words
  word2Vec = ml5.word2vec('https://cdtokushima.github.io/open/chatbot/word2vec/wordvecs3000ja.json', modelLoaded);

	word = '犬';

  // Finding the nearest words
	/*
  word2Vec.nearest(word, (err, result) => {
    let output = '';
    if (result) {
      for (let i = 0; i < result.length; i++) {
        output += result[i].word + '<br/>';
      }
    } else {
      output = 'No word vector found';
    }
    console.log(output);
  });
	*/
	nearest(word);
}

const nearest = async function(word){
	output = [];
	const result = await word2Vec.nearest(word);
  if (result) {
    for (let i = 0; i < result.length; i++) {
      output.push(result[i].word);
    }
  }
  console.log(output);
	//console.log(result);
	return output;
}
