function getDateTime() {
  const now = new Date();
  const gmt =
    'GMT ' + (-now.getTimezoneOffset() < 0 ? '-' : '+') + Math.abs(now.getTimezoneOffset() / 60);
  return now.toLocaleString() + gmt;
}

class ChatBot {
  #$element;
  #data;
  #url;
  #keyLS;
  #delay = 100;
  #botId = 0;
  #contentIndex = 1;
  #start = true;
  #fields = {};

  // common pattern
  #template(type, content, state = '') {
    return `<div class='chatbot__item chatbot__item_${type}'>
      <div class='chatbot__content chatbot__content_${type}${state}'>${content}</div>
    </div>`;
  }

  // button template
  #templateBtn(botId, content) {
    return `<button class="btn" type="button" data-bot-id="${botId}">${content}</button>`;
  }

  // Designer
  constructor(config) {
    if (config['element']) {
      this.#$element = config['element'];
    } else {
      throw 'ChatBot: the element key must be present in the transmitted data';
    }
    if (config['data']) {
      this.#data = config['data'];
    } else {
      throw 'ChatBot: the data key must be present in the transmitted data';
    }
    this.#url = config['url'] ? config['url'] : 'chatbot.html';
    this.#keyLS = config['keyLS'] ? config['keyLS'] : 'fingerprint';

    const fromStorage = undefined; //localStorage.getItem('chatbot');
    if (fromStorage) {
      const dataFromStorage = JSON.parse(fromStorage);
      for (let key in dataFromStorage.fields) {
        this.#fields[key] = dataFromStorage.fields[key];
      }
      let html = [];
      dataFromStorage.data.forEach(value => {
        const state = value.type === 'bot' ? '' : '-disabled';
        const code = this.#template(value.type, value.content, state);
        html.push(code);
      });
      const $container = this.#$element.querySelector('.chatbot__items');
      $container.insertAdjacentHTML('beforeend', html.join(''));
      this.#botId = dataFromStorage.botId;
      this.#outputContent(0);
    } else {
      this.#outputContent(this.#delay);
    }
    this.#addEventListener();
  }

  // gather information
  #getData(target, id) {
    const chatObj = this.#data[target];
    return chatObj[id];
  }

  // content output
  #outputContent(interval) {
    const botData = this.#getData('bot', this.#botId);
    const humanIds = botData.human;
    const $container = this.#$element.querySelector('.chatbot__items');
    let botContent = botData.content;
    if (botContent.indexOf('{{') !== -1) {
      for (let key in this.#fields) {
        botContent = botContent.replaceAll(`{{${key}}}`, this.#fields[key]);
      }
    }
    const $botContent = this.#template('bot', botContent);
    const fn1 = () => {
      $container.insertAdjacentHTML('beforeend', $botContent);
      $container.scrollTop = $container.scrollHeight;
    };
    const fn2 = () => {
      if (this.#getData('human', humanIds[0]).content === '') {
        this.#$element.querySelector('.chatbot__input').disabled = false;
        this.#$element.querySelector('.chatbot__input').dataset.name = this.#getData(
          'human',
          humanIds[0]
        ).name;
        this.#$element.querySelector('.chatbot__submit').disabled = true;
        this.#$element.querySelector('.chatbot__input').focus();
        this.#$element.querySelector('.chatbot__submit').dataset.botId = this.#getData(
          'human',
          humanIds[0]
        ).bot;
      } else {
        this.#$element.querySelector('.chatbot__input').value = '';
        this.#$element.querySelector('.chatbot__input').disabled = true;
        this.#$element.querySelector('.chatbot__submit').disabled = true;
        const $humanContent = humanIds.map(id => {
          const humanData = this.#getData('human', id);
          return this.#templateBtn(humanData.bot, humanData.content);
        });
        const $humanContentWrapper = this.#template('human', $humanContent.join(''));
        $container.insertAdjacentHTML('beforeend', $humanContentWrapper);
        $container.scrollTop = $container.scrollHeight;
      }
    };
    if (interval) {
      window.setTimeout(() => {
        fn1();
        window.setTimeout(() => {
          fn2();
        }, interval);
      }, interval);
    } else {
      fn1();
      fn2();
    }
  }

  // to transfer the user response to inactive
  #humanResponseToDisabled($target) {
    const $container = $target.closest('.chatbot__content_human');
    const content = $target.innerHTML;
    $container.innerHTML = content;
    $container.classList.remove('chatbot__content_human');
    $container.classList.add('chatbot__content_human-disabled');
    return content;
  }

  #addToChatHumanResponse(humanContent) {
    const $container = this.#$element.querySelector('.chatbot__items');
    const $humanContent = this.#template('human', humanContent, '-disabled');
    $container.insertAdjacentHTML('beforeend', $humanContent);
    $container.scrollTop = $container.scrollHeight;
  }

  // function to handle the click event
  async #eventHandlerClick(e) {
    const $target = e.target;
    const botId = $target.dataset.botId;
    const url = this.#url;
    let data = {};
    let humanContent = '';
    let humanField = '';
    if ($target.closest('.chatbot__submit')) {
      if ($target.closest('.chatbot__submit').disabled) {
        return;
      }
      if (!this.#$element.querySelector('.chatbot__input').value.length) {
      }
      this.#botId = +$target.closest('.chatbot__submit').dataset.botId;
      humanContent = this.#$element.querySelector('.chatbot__input').value;
      humanField = this.#$element.querySelector('.chatbot__input').dataset.name;
			const content = await input(humanField, humanContent);
      this.#fields[humanField] = content[0];
			if (content[1] !== '') {
				this.#fields['answer'] = content[1];
				this.#botId = 99;
			}
      this.#addToChatHumanResponse(humanContent);
      this.#outputContent(this.#delay);
    } else if (botId) {
      this.#botId = +botId;
      // Turn the user's response to inactive
      humanContent = this.#humanResponseToDisabled($target);
      // display the following content
      this.#outputContent(this.#delay);
    } else if ($target.classList.contains('chatbot__close')) {
      $target.closest('.chatbot').classList.add('chatbot_hidden');
      document.querySelector('.chatbot-btn').classList.remove('chatbot-btn_hidden');
      return;
    } else {
      return;
    }
    e.preventDefault();
    // getting the bot's latest message
    const $botWrapper = document.querySelectorAll('.chatbot__item_bot');
    const $botContent = $botWrapper[$botWrapper.length - 1];
    const $botItems = $botContent.querySelectorAll('.chatbot__content');
    $botItems.forEach($element => {
      data[this.#contentIndex] = {
        type: 'bot',
        content: $element.innerHTML,
      };
      this.#contentIndex++;
    });
    data[this.#contentIndex] = {
      type: 'human',
      content: humanContent,
    };
    this.#contentIndex++;
		/*
    const fromStorage = localStorage.getItem('chatbot');
    let dataToStorage = [];
    let fieldsToStorage = {};
    if (fromStorage) {
      dataToStorage = JSON.parse(fromStorage).data;
      fieldsToStorage = JSON.parse(fromStorage).fields;
    }
    for (const key in data) {
      dataToStorage.push({
        type: data[key].type,
        content: data[key].content,
      });
    }
    if (humanField) {
      fieldsToStorage[humanField] = humanContent;
    }
    const dataToStorageJSON = JSON.stringify({
      botId: this.#botId,
      data: dataToStorage,
      fields: fieldsToStorage,
    });
    localStorage.setItem('chatbot', dataToStorageJSON);
		*/
		/*
    // shipping details
    const dataSend = JSON.stringify(//{
      //id: localStorage.getItem(this.#keyLS),
      //chat: data,
      //start: this.#start,
      //date: getDateTime(),
    //}
			{"text": "Hello World"}
		);


    this.#start = false;

    // Send the data to the server

    var request = new XMLHttpRequest();
    request.onreadystatechange = function () {
      if (request.readyState === 0 || request.readyState === 4) {
        if (request.status == 200) {
          //console.log(JSON.parse(request.responseText));
        } else {
          //console.log('error');
        }
      }
    };
    request.open('POST', url);
    request.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    request.setRequestHeader('Content-Type', 'application/json');
    request.send(dataSend);
		*/
  }

  // function to handle the change event
  #eventHandlerKeydown(e) {
    const $target = e.target;
    if (!$target.classList.contains('chatbot__input')) {
      return;
    }
    const btnSubmit = this.#$element.querySelector('.chatbot__submit');
    if ($target.value.length > 0) {
      btnSubmit.disabled = false;
    } else {
      btnSubmit.disabled = true;
    }
  }

  // function to handle the key event
  #eventHandlerKeypress(e) {
  	if (e.keyCode === 13) {
			//this.#eventHandlerClick(e);
			//let e = new Event('click');
			document.querySelector('.chatbot__submit').click();
		}
		return false;
	}

  // Connecting event handlers
  #addEventListener() {
    this.#$element.addEventListener('click', this.#eventHandlerClick.bind(this));
    this.#$element.addEventListener('input', this.#eventHandlerKeydown.bind(this));
		this.#$element.addEventListener('keypress', this.#eventHandlerKeypress.bind(this));
  }
}

const chatbotTemplate = () => {
  return `<div class="chatbot chatbot_hidden">
    <div class="chatbot__title">
      Chatbot
      <span class="chatbot__close">×</span>
    </div>
    <div class="chatbot__wrapper">
      <div class="chatbot__items"></div>
    </div>
    <div class="chatbot__footer">
      <input class="chatbot__input" type="text" disabled>
      <button class="chatbot__submit" type="button" disabled>
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="16" height="16"><path fill="currentColor" d="M476 3.2L12.5 270.6a24 24 0 002.2 43.2L121 358.4l287.3-253.2c5.5-4.9 13.3 2.6 8.6 8.3L176 407v80.5a24 24 0 0042.5 15.8L282 426l124.6 52.2a24 24 0 0033-18.2l72-432A24 24 0 00476 3.2z"/></svg>
      </button>
    </div>
  </div>`;
};

let chatbot;

const chatBotInit = config => {
  let $chatbot = document.querySelector('.chatbot');
  if (!$chatbot) {
    document.body.insertAdjacentHTML('beforeend', chatbotTemplate());
    $chatbot = document.querySelector('.chatbot');
  }

  config['element'] = $chatbot;
  document.querySelector(config.chatbotBtnSel).onclick = e => {
    const $chatbotToggle = e.target.closest(config.chatbotBtnSel);
    if ($chatbotToggle) {
      $chatbotToggle.classList.add('chatbot-btn_hidden');
      const $chatbotToggleTooltip = $chatbotToggle.querySelector('.chatbot-toggle-tooltip');
      if ($chatbotToggleTooltip) {
        $chatbotToggleTooltip.classList.remove('chatbot-toggle-tooltip_show');
      }
    }
    $chatbot.classList.toggle('chatbot_hidden');

    if (!chatbot) {
      chatbot = new ChatBot(config);
      return chatbot;
    }
  };
};

const datasetInit = dataset => {
	let q_ = document.querySelectorAll('.' + dataset.query);
	let a_ = document.querySelectorAll('.' + dataset.answer);
	let r_ = document.querySelectorAll('.' + dataset.refer);
	let queries = [];
	let answers = [];
	let refers = [];
	for (let i = 0; i < q_.length; i++) {
		queries.push(q_[i].innerText);
	}
	for (let i = 0; i < a_.length; i++) {
		answers.push(a_[i].innerHTML);
	}
	for (let i = 0; i < r_.length; i++) {
		refers.push(r_[i].innerText);
	}
	return {q: queries, a: answers, r: refers};
};



// 1 - Specifying the key in localstorage where the browser fingerprint will be stored
const keyLS = 'fingerprint';
// 2 - Specifying the CSS selector for the button that will be used to call the dialog window with the chatbot
const chatbotBtnSel = '.chatbot-btn';
// 3 - URL to index.html
const url = 'https://tokushimauniv.webhook.office.com/webhookb2/867d3b8b-a2f9-4b72-abfa-844f0e6ed5b1@8671c3a4-4538-47f6-8717-16a1d6b0ca98/IncomingWebhook/b4f60c8e8ac44f7f80c8814cb5ff0aa4/4f7c7e3f-d74d-41d6-b638-cce86cea6d72';
// 4 - Data description that defines the dialog script for the chatbot
const data = {
  bot: {
    0: {
      content: 'こんにちは！とくぽんAI塾です。何かご質問はありますか？', human: [0, 1, 2]
    },
    1: { content: 'そうなんですね。あなたのお名前は？', human: [3] },
    2: { content: 'あなたのお名前は？', human: [3] },
    3: { content: '{{name}}さん, 興味のあることは何ですか？', human: [4, 5] },
    4: { content: '{{name}}さん, こちらにアクセスしてください。 <a href="https://www.tokushima-u.ac.jp/ai/tokupon/" target="_blank">とくぽんAI塾</a>. こちらに詳しい情報があります。', human: [6] },
    5: { content: "{{name}}さん, ご質問はなんですか？", human: [7] },
    6: { content: '{{name}}さん, 次のいずれかの方法で詳しく教えてください。', human: [8, 9, 12] },
    7: { content: '{{name}}さん, お電話番号を教えてください。', human: [10] },
    8: { content: '{{name}}さん, Eメールアドレスを教えてください。', human: [10] },
    9: { content: 'OK! {{name}}さん, 折り返し {{contact}} へご連絡差し上げますので、少々お待ちください。', human: [6] },
    10: { content: 'ありがとう！あなたのお名前は？', human: [11] },
    11: { content: '<b>{{name}}さんもかわいいよ！</b> <br>興味のあることは何ですか？', human: [4, 5] },
		12: { content: 'こちらに<a href="tel:088-656-7095">電話</a>でお問い合わせください。', human: [6] },
		13: { content: 'こちらに<a href="mailto:kygakujc＠tokushima-u.ac.jp">メール</a>でお問い合わせください。', human: [6] },
		14: { content: 'こちらから<a href="https://www.tokushima-u.ac.jp/ai/asks/" target="_blank">Webフォーム</a>でお問い合わせください。', human: [6] },
    99: { content: '回答はこちら <br><br><div class="box">{{answer}}</div> <br>他に何か質問はありますか？', human: [4, 5] },
  },
  human: {
    0: { content: '質問したいことがあります。', bot: 1 },
    1: { content: '特にないです。', bot: 2 },
    2: { content: 'とくぽんかわいいね！', bot: 10 },
    3: { content: '', bot: 3, name: 'name' },
    4: { content: 'とくぽんAI塾に興味があります。', bot: 4 },
    5: { content: 'とくぽんAI塾について聞きたいことがあります。', bot: 5 },
    6: { content: '初めにもどる', bot: 3 },
    7: { content: '', bot: 6, name: '' },
    8: { content: '電話', bot: 12 },
    9: { content: 'Eメール', bot: 13 },
    10: { content: '', bot: 9, name: 'contact' },
    11: { content: '', bot: 11, name: 'name' },
    12: { content: 'Webフォーム', bot: 14 },
  }
}
// adding a fingerprint hash to localstorage
/*
let fingerprint = localStorage.getItem(keyLS);
if (!fingerprint) {
  Fingerprint2.get(function (components) {
    fingerprint = Fingerprint2.x64hash128(components.map(function (pair) { return pair.value }).join(), 31)
    localStorage.setItem(keyLS, fingerprint)
  });
}*/
// Initializing ChatBot by calling the following function and passing the required parameters to it
chatBotInit({
  chatbotBtnSel: chatbotBtnSel,
  data: data,
  url: url,
  keyLS: keyLS
});

setTimeout(function () {
  const chatbotToggleTooltip = document.querySelector('.chatbot-toggle-tooltip');
  chatbotToggleTooltip.classList.add('chatbot-toggle-tooltip_show');
  setTimeout(function () {
    chatbotToggleTooltip.classList.remove('chatbot-toggle-tooltip_show');
  }, 10000)
}, 10000)



const contentword = ['名詞', '動詞', '助動詞', '記号'];//, '形容詞'];
const basicword = ['名詞', '動詞', '形容詞'];
const stopword = ['?', '!', '。', '、', ',', '.'];
const builder = kuromoji.builder({ dicPath: RELATIVE_PATH })

	var toHalfWidth = function(value) {
		if (!value) return value;

		return String(value).replace(/[！-～]/g, function(all) {
			return String.fromCharCode(all.charCodeAt(0) - 0xFEE0);
		});
	};

	const analyzeKeyword = function(query_) {
		if (!query_ || query_ === '') {
			return [];
		}
		let keywords = [];
    let path = tokenizer_.tokenize(query_);
		let prev = '';
		for (const element of path) {
			if (!contentword.includes(element.pos)) {
				prev = '';
				continue;
			}
	  	keywords.push(toHalfWidth(element.surface_form.toLowerCase()));
			if (prev.length > 0) {
					prev += element.surface_form;
		  	keywords.push(toHalfWidth(prev.toLowerCase()));
			} else {
					prev += element.surface_form;
			}
			if (element.word_type !== "UNKNOWN" && basicword.includes(element.pos)) {
				keywords.push(toHalfWidth(element.basic_form.toLowerCase()));
				keywords.push(toHalfWidth(element.pronunciation));
			}
		}
		return keywords;
	};

	const buildFunction = (string) => {
	  return (err, tokenizer) => {
			tokenizer_ = tokenizer;
	    //console.log('string',string);
	    //let path = tokenizer.tokenize(string);
	    //console.log('path',path);
	    //const target = document.getElementById("output");
			//output = '';
			//for (const element of path) {
			//  output += element.surface_form + ' ' + element.pos + '<br>';
			//}
	    //target.innerHTML = output;
			//humanContent = output;

			dataset = datasetInit({
				query: 'q',
				answer: 'a',
				refer: 'r',
			});
			for (let i = 0; i < dataset.q.length; i++) {
				query_ = i < dataset.q.length ? dataset.q[i] : '';
				let keys = analyzeKeyword(query_);
				answer_ = i < dataset.a.length ? dataset.a[i] : '';
				let anss = analyzeKeyword(answer_);
				refer_ = i < dataset.r.length ? dataset.r[i] : '';
				let refs = analyzeKeyword(refer_);
				dataset_.push({
						key: keys.concat(refs),
						ans: anss,
						a: dataset.a[i]
					});
			}
			//	alert(dataset_);
	  }
	};

	let dataset_ = [];
	let tokenizer_ = undefined;
	if (!tokenizer_) {
		builder.build(buildFunction(''));
	}

	const analyze = function() {
		const target = document.getElementById("sentence");
		if (target) {
			val = target.value;
		}
		if (typeof val === 'string' && val.length > 0) {
//		let result = builder.build(buildFunction(target.value));
			if (tokenizer_) {
		    let path = tokenizer_.tokenize(target.value);
		    //console.log('path',path);
		    const outtarget = document.getElementById("output");
				output = '';
				for (const element of path) {
				  output += element.surface_form + ' ' + element.pos + '<br>';
				}
		    outtarget.innerHTML = output;
			}
		}
	};

let timer = null;

const inputted = function() {
	if (timer != null) {
		clearTimeout(timer);
		timer = null;
	}
	timer = setTimeout(analyze, 1000);
};

const input = async function(type, message) {
	if (typeof message === 'string' && message.length > 0) {
		if (tokenizer_) {
	    let path = tokenizer_.tokenize(message);
	    const outtarget = document.getElementById("output");
			let output = [];
			for (const element of path) {
			  //output += element.surface_form + ' ' + element.pos + '<br>';
				output.push([element.surface_form, element.pos]);
			}
			let content = '';
			let response = '';
			//builder.build(buildFunction(message));
			switch (type) {
				case 'name':
					// 敬称チェック
					switch (output[output.length-1][0]) {
						case 'くん':	case '君':	case 'さん':	case '様':
						case 'さま':	case 'ちゃん':	case '社長':	case '部長':
						case '課長':	case '係長':	case '委員長':	case '組長':
							output.pop();
						break;
					}
					for (const word of output) {
					  response += word[0] + ' ' + word[1] + '<br>';
						content += word[0];
					}
			    outtarget.innerHTML = response;
					return [content, ""];
				break;
				case 'contact':
					// 連絡先
			    outtarget.innerHTML = response;
					return [message, content];
				break;
				case '':
				{
					let queries = [];
					let prev = '';
					// 質問チェック
					for (const element of path) {
					  response += element.surface_form + ' ' + element.pos + '<br>';
						if (!contentword.includes(element.pos)) {
							prev = '';
							continue;
						}
						if (prev.length > 0) {
 							prev += element.surface_form;
					  	queries.push(toHalfWidth(prev.toLowerCase()));
						} else {
 							prev += element.surface_form;
						}
				  	queries.push(toHalfWidth(element.surface_form.toLowerCase()));
						if (element.word_type !== "UNKNOWN" && basicword.includes(element.pos)) {
							queries.push(toHalfWidth(element.basic_form.toLowerCase()));
							queries.push(toHalfWidth(element.pronunciation));
						}
					}
			    outtarget.innerHTML = response;
					// 回答検索
					let answers = new Array(dataset_.length).fill(0);
					for (const word of queries) {
						if (stopword.includes(word)) {
							continue;
						}
						let result = await nearest(word);
						//console.log(result);
						result.unshift(word);
						for (const word of result) {
							for (let i = 0; i < dataset_.length; i++) {
								let key_ = dataset_[i].key;
								if (key_.includes(word)) {
									//content += dataset_[i].a;
									//alert(content);
									answers[i] += 1 / Math.sqrt(key_.length + 1);
								}
								let ans_ = dataset_[i].ans;
								if (ans_.includes(word)) {
									//content += dataset_[i].ans;
									//alert(content);
									answers[i] += 0.5 / Math.sqrt(ans_.length + 1);
								}
							}
						}
					}
					let maxans = [-1, 0];
					let count = 0;
					for (let i = 0; i < answers.length; i++) {
						if (answers[i] > 0) {
							count++;
						}
						if (answers[i] > maxans[1]) {
							maxans[0] = i;
							maxans[1] = answers[i];
						}
					}
					if (maxans[1] > (count / (answers.length + queries.length))) {
						content = dataset_[maxans[0]].a;
					}
					return [message, content];
				}
				break;
				default:
				return [message, ""];
				break;
			}
		}
	}
}
