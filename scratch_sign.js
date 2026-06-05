const crypto = require('crypto');

function filterObject(obj) {
  const excludeFields = ['signature', 'timestamp', 'track'];
  const filtered = {};
  for (const key in obj) {
    if (!excludeFields.includes(key) && obj[key] !== null && obj[key] !== undefined && obj[key] !== '') {
      filtered[key] = obj[key];
    }
  }
  return filtered;
}

function sortObject(obj) {
  const sorted = {};
  Object.keys(obj).sort().forEach((key) => {
    sorted[key] = obj[key];
  });
  return sorted;
}

function calculateSignature(data, secret = '') {
  const filtered = filterObject(data);
  const sorted = sortObject(filtered);
  const jsonString = JSON.stringify(sorted);
  console.log("JSON STRING BEFORE MD5:", jsonString);
  const fullString = jsonString + secret;
  return crypto.createHash('md5').update(fullString).digest('hex').toUpperCase();
}

const payload = {
  "formId": 200198,
  "workOrderTypeId": 2,
  "formFields": [
    {
      "typeCode": "UserName",
      "fieldId": 200301,
      "fieldValue": "916003199726"
    },
    {
      "typeCode": "LongText",
      "fieldId": 200302,
      "fieldValue": "916003199726_user001"
    }
  ],
  "language": "en",
  "random": 273060795368,
  "timestamp": 1780548934
};

function hash(str) { return crypto.createHash('md5').update(str).digest('hex').toUpperCase(); }

// Scenario 1: With timestamp included
const dataWithTs = {...payload};
const filteredTs = filterObject(dataWithTs);
filteredTs.timestamp = payload.timestamp; // force include
console.log("With Timestamp:", hash(JSON.stringify(sortObject(filteredTs))));

// Scenario 2: formFields as a string instead of array
const dataStringified = {...payload, formFields: JSON.stringify(payload.formFields)};
console.log("With formFields stringified:", hash(JSON.stringify(sortObject(filterObject(dataStringified)))));

// Scenario 3: Secret = some common default? "123456" "qwer1234"
console.log("With secret qwer1234:", hash(JSON.stringify(sortObject(filterObject(payload))) + "qwer1234"));

// Scenario 4: formFields completely removed (maybe backend doesn't sign arrays?)
const dataNoFields = {...payload}; delete dataNoFields.formFields;
console.log("No formFields:", hash(JSON.stringify(sortObject(filterObject(dataNoFields)))));

